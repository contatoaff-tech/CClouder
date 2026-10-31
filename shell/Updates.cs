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

    static string RunCaptured(string exe, string args, int timeoutMs)
    {
        var psi = new ProcessStartInfo(exe, args)
        {
            CreateNoWindow = true,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = System.Text.Encoding.UTF8,
        };
        using var p = Process.Start(psi) ?? throw new Exception($"não foi possível iniciar {exe}");
        string outp = p.StandardOutput.ReadToEnd();
        p.WaitForExit(timeoutMs);
        return outp;
    }

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
            try { t1[p.Id] = p.TotalProcessorTime; } catch { }
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
            catch { }
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
                catch { after += ws; }
                CloseHandle(h);
            }
            catch { }
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
        string url = "";
        long size = 0;
        if (doc.RootElement.TryGetProperty("assets", out var assets) && assets.ValueKind == JsonValueKind.Array)
        {
            foreach (var a in assets.EnumerateArray())
            {
                string an = a.TryGetProperty("name", out var n) ? n.GetString() ?? "" : "";
                if (an.Equals("CClouder.exe", StringComparison.OrdinalIgnoreCase))
                {
                    url = a.TryGetProperty("browser_download_url", out var u) ? u.GetString() ?? "" : "";
                    size = a.TryGetProperty("size", out var s) ? s.GetInt64() : 0;
                }
            }
        }
        string current = typeof(Backend).Assembly.GetName().Version?.ToString(3) ?? "0.0.0";
        string latest = tag.TrimStart('v', 'V');
        bool has = !string.Equals(current, latest, StringComparison.OrdinalIgnoreCase);
        string notes = doc.RootElement.TryGetProperty("body", out var b) ? b.GetString() ?? "" : "";
        return new { current, latest, has_update = has, url, size, notes };
    }

    public static object DownloadAppUpdate(string url)
    {
        if (string.IsNullOrWhiteSpace(url)) throw new Exception("URL de download vazia");
        string currentExe = Environment.ProcessPath ?? "";
        if (!currentExe.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
            throw new Exception("a auto-atualização só funciona no exe publicado");

        string temp = Path.Combine(Path.GetTempPath(), "CClouder-update.exe");
        using (var http = NewGithubClient())
        {
            byte[] bytes = http.GetByteArrayAsync(url).GetAwaiter().GetResult();
            File.WriteAllBytes(temp, bytes);
        }
        string bat = Path.Combine(Path.GetTempPath(), "cclinear-update.bat");
        File.WriteAllText(bat,
            "@echo off\r\n" +
            "timeout /t 3 /nobreak >nul\r\n" +
            $"copy /y \"{temp}\" \"{currentExe}\" >nul\r\n" +
            $"start \"\" \"{currentExe}\"\r\n" +
            "del \"%~f0\" >nul\r\n");
        Process.Start(new ProcessStartInfo("cmd.exe", $"/c \"{bat}\"")
        {
            CreateNoWindow = true,
            UseShellExecute = false,
        });
        return new { ok = true, downloaded_to = temp };
    }
}