using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace CClouder;

// ======================================================================
// Updates (v1.3): Software Updater (winget), Processos + otimizador de
// memória e Auto-update do próprio CClouder via GitHub Releases.
// ======================================================================
public static partial class Backend
{
    // ============================ SOFTWARES (winget) ============================

    public static object GetSoftwareUpdates()
    {
        string ver;
        try { ver = RunCaptured("winget", "--version", 20000).Trim(); }
        catch (Exception ex) { throw new Exception("winget não encontrado (App Installer): " + ex.Message); }

        string raw = RunCaptured("winget",
            "upgrade --include-unknown --accept-source-agreements --disable-interactivity", 240000);

        var rows = new List<object>();
        foreach (var line in raw.Split('\n'))
        {
            string l = line.TrimEnd('\r');
            if (string.IsNullOrWhiteSpace(l)) continue;
            string t = l.Trim();
            if (t.StartsWith("Nome", StringComparison.OrdinalIgnoreCase)) continue;
            if (t.StartsWith("Name", StringComparison.OrdinalIgnoreCase)) continue;
            if (t.All(c => c == '-' || c == ' ')) continue;
            if (t.Contains("pacotes", StringComparison.OrdinalIgnoreCase) &&
                t.Contains("atualiza", StringComparison.OrdinalIgnoreCase)) continue;
            var parts = Regex.Split(t, @"\s{2,}").Where(s => s.Trim().Length > 0).Select(s => s.Trim()).ToList();
            if (parts.Count < 5) continue;
            string source = parts[^1];
            string available = parts[^2];
            string installed = parts[^3];
            string id = parts[^4];
            string name = string.Join(" ", parts.Take(parts.Count - 4));
            if (string.IsNullOrWhiteSpace(id) || id.Contains(' ') || string.IsNullOrWhiteSpace(name)) continue;
            if (!id.Contains('.') && !id.Contains('\\')) continue; // id do winget sempre tem ponto ou barra
            rows.Add(new { name, id, installed, available, source });
        }
        return new { winget_version = ver, count = rows.Count, packages = rows };
    }

    public static object UpgradeSoftware(string id)
    {
        if (string.IsNullOrWhiteSpace(id)) throw new Exception("id vazio");
        var psi = new ProcessStartInfo("winget",
            $"upgrade --id \"{id}\" --silent --accept-package-agreements --accept-source-agreements --disable-interactivity")
        {
            CreateNoWindow = true,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = System.Text.Encoding.UTF8,
        };
        using var p = Process.Start(psi) ?? throw new Exception("não foi possível iniciar o winget");
        string o = p.StandardOutput.ReadToEnd();
        string e = p.StandardError.ReadToEnd();
        p.WaitForExit(600000);
        return new { ok = p.ExitCode == 0, exit_code = p.ExitCode, output = (o + "\n" + e).Trim() };
    }

    // ============================ PROCESSOS / MEMÓRIA ============================

    [DllImport("psapi.dll", SetLastError = true)]
    static extern bool EmptyWorkingSet(IntPtr hProcess);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr OpenProcess(uint access, bool inherit, int pid);

    [DllImport("kernel32.dll")]
    static extern bool CloseHandle(IntPtr h);

    const uint PROCESS_SET_QUOTA = 0x0100;
    const uint PROCESS_QUERY_INFORMATION = 0x0400;

    public static object GetProcesses()
    {
        var procs = Process.GetProcesses();
        int cores = Math.Max(1, Environment.ProcessorCount);
        var t1 = new Dictionary<int, TimeSpan>();
        foreach (var p in procs)
        {
            try { t1[p.Id] = p.TotalProcessorTime; } catch (Exception ex) { Diag.Swallow("Updates/#3", ex); }
        }
        Thread.Sleep(400);
        var list = new List<(string name, int pid, ulong ws, double cpu)>();
        foreach (var p in procs)
        {
            try
            {
                ulong ws = (ulong)p.WorkingSet64;
                double cpu = 0;
                if (t1.TryGetValue(p.Id, out var before))
                {
                    var delta = p.TotalProcessorTime - before;
                    cpu = Math.Max(0, delta.TotalMilliseconds / 400.0 / cores * 100.0);
                }
                list.Add((p.ProcessName, p.Id, ws, cpu));
            }
            catch (Exception ex) { Diag.Swallow("Updates/#4", ex); }
        }
        var ordered = list
            .OrderByDescending(x => x.ws)
            .Take(60)
            .Select(x => (object)new
            {
                name = x.name,
                pid = x.pid,
                working_set = x.ws,
                cpu = Math.Round(x.cpu, 1),
            })
            .ToList();
        ulong total = list.Aggregate(0UL, (acc, x) => acc + x.ws);
        return new { processes = ordered, total_working_set = total, cores };
    }

    public static object OptimizeMemory()
    {
        ulong before = 0, after = 0;
        int count = 0;
        foreach (var p in Process.GetProcesses())
        {
            try
            {
                ulong ws = (ulong)p.WorkingSet64;
                IntPtr h = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_SET_QUOTA, false, p.Id);
                if (h == IntPtr.Zero) continue;
                before += ws;
                if (EmptyWorkingSet(h)) count++;
                try { p.Refresh(); after += (ulong)p.WorkingSet64; }
                catch (Exception ex) { Diag.Swallow("Updates/#5", ex); after += ws; }
                CloseHandle(h);
            }
            catch (Exception ex) { Diag.Swallow("Updates/#6", ex); }
        }
        ulong freed = before > after ? before - after : 0;
        return new { processes = count, freed_bytes = freed };
    }

    public static object KillProcess(int pid)
    {
        try
        {
            using var p = Process.GetProcessById(pid);
            p.Kill(true);
            return new { ok = true };
        }
        catch (Exception ex)
        {
            throw new Exception("não foi possível encerrar: " + ex.Message);
        }
    }

    // ============================ AUTO-UPDATE ============================

    const string RepoLatest = "https://api.github.com/repos/contatoaff-tech/CClouder/releases/latest";

    static HttpClient NewGithubClient()
    {
        var http = new HttpClient { Timeout = TimeSpan.FromMinutes(5) };
        http.DefaultRequestHeaders.Add("User-Agent", "CClouder-Updater");
        http.DefaultRequestHeaders.Add("Accept", "application/vnd.github+json");
        return http;
    }

    public static object CheckAppUpdate()
    {
        using var http = NewGithubClient();
        http.Timeout = TimeSpan.FromSeconds(25);
        string json;
        try { json = http.GetStringAsync(RepoLatest).GetAwaiter().GetResult(); }
        catch (Exception ex) { throw new Exception("falha ao consultar o GitHub: " + ex.Message); }

        using var doc = JsonDocument.Parse(json);
        string tag = doc.RootElement.TryGetProperty("tag_name", out var t) ? t.GetString() ?? "" : "";
        if (!System.Text.RegularExpressions.Regex.IsMatch(tag, @"^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$"))
            throw new Exception("tag de versão inválida recebido do GitHub");
        string url = "";
        string digest = "";
        long size = 0;
        if (doc.RootElement.TryGetProperty("assets", out var assets) && assets.ValueKind == JsonValueKind.Array)
        {
            foreach (var a in assets.EnumerateArray())
            {
                string an = a.TryGetProperty("name", out var n) ? n.GetString() ?? "" : "";
                if (an.Equals("CClouder.exe", StringComparison.OrdinalIgnoreCase))
                {
                    url = a.TryGetProperty("browser_download_url", out var u) ? u.GetString() ?? "" : "";
                    digest = a.TryGetProperty("digest", out var d) ? d.GetString() ?? "" : "";
                    size = a.TryGetProperty("size", out var s) ? s.GetInt64() : 0;
                }
            }
        }
        string current = typeof(Backend).Assembly.GetName().Version?.ToString(3) ?? "0.0.0";
        string latest = tag.TrimStart('v', 'V');
        if (!Version.TryParse(current, out var currentVersion) || !Version.TryParse(latest, out var latestVersion))
            throw new Exception("não foi possível comparar as versões do aplicativo");
        bool has = latestVersion > currentVersion;
        string notes = doc.RootElement.TryGetProperty("body", out var b) ? b.GetString() ?? "" : "";
        return new { current, latest, has_update = has, url, size, digest, notes };
    }

    internal static void VerifyUpdateBytes(byte[] bytes, long expectedSize, string expectedDigest)
    {
        if (bytes.Length < 1024 || bytes[0] != (byte)'M' || bytes[1] != (byte)'Z')
            throw new Exception("o arquivo baixado não parece ser um executável Windows válido");
        if (expectedSize > 0 && bytes.LongLength != expectedSize)
            throw new Exception("o tamanho do download não corresponde ao asset publicado");
        if (!System.Text.RegularExpressions.Regex.IsMatch(expectedDigest, @"^sha256:[0-9a-fA-F]{64}$"))
            throw new Exception("a release não publicou SHA-256; atualização recusada por segurança");
        string actualDigest = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(bytes));
        if (!actualDigest.Equals(expectedDigest[7..], StringComparison.OrdinalIgnoreCase))
            throw new Exception("a verificação SHA-256 do download falhou");
    }

    static string PsLiteral(string value) => "'" + value.Replace("'", "''") + "'";

    public static object DownloadAppUpdate(string url)
    {
        if (string.IsNullOrWhiteSpace(url) ||
            !Uri.TryCreate(url, UriKind.Absolute, out var updateUri) ||
            updateUri.Scheme != Uri.UriSchemeHttps || !updateUri.IsDefaultPort ||
            !updateUri.Host.Equals("github.com", StringComparison.OrdinalIgnoreCase) ||
            !updateUri.AbsolutePath.StartsWith("/contatoaff-tech/CClouder/releases/download/", StringComparison.OrdinalIgnoreCase) ||
            !updateUri.AbsolutePath.EndsWith("/CClouder.exe", StringComparison.OrdinalIgnoreCase))
            throw new Exception("URL de download inválida; use o executável das releases oficiais do GitHub");
        string currentExe = Environment.ProcessPath ?? "";
        if (!currentExe.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
            throw new Exception("a auto-atualização só funciona no exe publicado");

        var release = CheckAppUpdate();
        using var releaseDoc = JsonDocument.Parse(JsonSerializer.Serialize(release));
        string expectedUrl = releaseDoc.RootElement.GetProperty("url").GetString() ?? "";
        string expectedDigest = releaseDoc.RootElement.GetProperty("digest").GetString() ?? "";
        long expectedSize = releaseDoc.RootElement.GetProperty("size").GetInt64();
        if (!Uri.TryCreate(expectedUrl, UriKind.Absolute, out var releaseUri) ||
            !string.Equals(releaseUri.AbsoluteUri, updateUri.AbsoluteUri, StringComparison.OrdinalIgnoreCase))
            throw new Exception("o endereço não corresponde ao executável da release oficial mais recente");

        string downloadPath = Path.Combine(Path.GetTempPath(), "CClouder-update-" + Guid.NewGuid().ToString("N") + ".exe");
        string candidatePath = currentExe + ".update-" + Guid.NewGuid().ToString("N");
        string backupPath = currentExe + ".previous-" + Guid.NewGuid().ToString("N");
        string scriptPath = Path.Combine(Path.GetTempPath(), "CClouder-update-" + Guid.NewGuid().ToString("N") + ".ps1");
        try
        {
            byte[] bytes;
            using (var http = NewGithubClient())
                bytes = http.GetByteArrayAsync(updateUri).GetAwaiter().GetResult();
            VerifyUpdateBytes(bytes, expectedSize, expectedDigest);
            File.WriteAllBytes(downloadPath, bytes);
            // Stage beside the installed executable so the final replacement is on the same volume.
            File.Copy(downloadPath, candidatePath, overwrite: false);
            File.Delete(downloadPath);

            string script =
                "$ErrorActionPreference = 'Stop'\r\n" +
                "$target = " + PsLiteral(currentExe) + "\r\n" +
                "$candidate = " + PsLiteral(candidatePath) + "\r\n" +
                "$backup = " + PsLiteral(backupPath) + "\r\n" +
                "$log = Join-Path $env:LOCALAPPDATA 'CClouder\\update.log'\r\n" +
                "$null = New-Item -ItemType Directory -Path (Split-Path -Parent $log) -Force\r\n" +
                "Start-Sleep -Seconds 2\r\n" +
                "$installed = $false\r\n" +
                "for ($i = 0; $i -lt 20; $i++) { try { [System.IO.File]::Replace($candidate, $target, $backup, $true); $installed = $true; break } catch { Start-Sleep -Seconds 1 } }\r\n" +
                "if (-not $installed) { ('Falha ao substituir o executável em ' + (Get-Date)) | Set-Content -LiteralPath $log -Encoding UTF8; exit 1 }\r\n" +
                "try { Start-Process -FilePath $target; try { Remove-Item -LiteralPath $backup -Force } catch {}; exit 0 } catch { try { [System.IO.File]::Replace($backup, $target, $candidate, $true) } catch {}; ($_ | Out-String) | Set-Content -LiteralPath $log -Encoding UTF8; exit 1 }\r\n";
            File.WriteAllText(scriptPath, script, new System.Text.UTF8Encoding(encoderShouldEmitUTF8Identifier: false));

            var psi = new ProcessStartInfo("powershell.exe")
            {
                CreateNoWindow = true,
                UseShellExecute = false,
                WindowStyle = ProcessWindowStyle.Hidden,
            };
            psi.ArgumentList.Add("-NoProfile");
            psi.ArgumentList.Add("-NonInteractive");
            psi.ArgumentList.Add("-ExecutionPolicy");
            psi.ArgumentList.Add("Bypass");
            psi.ArgumentList.Add("-File");
            psi.ArgumentList.Add(scriptPath);
            _ = Process.Start(psi) ?? throw new Exception("não foi possível iniciar o helper de atualização");
            return new { ok = true, restart_required = true };
        }
        catch
        {
            try { if (File.Exists(downloadPath)) File.Delete(downloadPath); } catch (Exception ex) { Diag.Swallow("Updates/#4", ex); }
            try { if (File.Exists(candidatePath)) File.Delete(candidatePath); } catch (Exception ex) { Diag.Swallow("Updates/#5", ex); }
            try { if (File.Exists(scriptPath)) File.Delete(scriptPath); } catch (Exception ex) { Diag.Swallow("Updates/#6", ex); }
            throw;
        }
    }
}