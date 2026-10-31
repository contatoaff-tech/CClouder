using Microsoft.Win32;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Text.Json;

namespace CClouder;

// ======================================================================
// Tools (v1.2): Duplicatas, Shredder, Menu de contexto, Tasks agendadas,
// Exclusões e Health Check.
// ======================================================================
public static partial class Backend
{
    // ============================ EXCLUSÕES ============================

    static readonly List<string> _exclusions = new();
    static bool _exclusionsLoaded;
    static readonly object _exclLock = new();

    static string ExclusionsFile =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "CClouder", "exclusions.json");

    public static List<string> GetExclusions()
    {
        lock (_exclLock) { EnsureExclusions(); return new List<string>(_exclusions); }
    }

    static void EnsureExclusions()
    {
        if (_exclusionsLoaded) return;
        try
        {
            // migração do nome antigo (CClinear) para CClouder, sem perder exclusões
            if (!File.Exists(ExclusionsFile))
            {
                string legacy = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "CClinear", "exclusions.json");
                if (File.Exists(legacy))
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(ExclusionsFile)!);
                    File.Copy(legacy, ExclusionsFile, overwrite: false);
                }
            }
            if (File.Exists(ExclusionsFile))
            {
                var arr = JsonSerializer.Deserialize<List<string>>(File.ReadAllText(ExclusionsFile));
                if (arr != null) _exclusions.AddRange(arr.Where(s => !string.IsNullOrWhiteSpace(s)));
            }
        }
        catch { }
        _exclusionsLoaded = true;
    }

    static void SaveExclusions()
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(ExclusionsFile)!);
            File.WriteAllText(ExclusionsFile, JsonSerializer.Serialize(_exclusions));
        }
        catch { }
    }

    public static object AddExclusion(string path)
    {
        path = path.Trim().Trim('"');
        if (string.IsNullOrWhiteSpace(path)) throw new Exception("caminho vazio");
        lock (_exclLock)
        {
            EnsureExclusions();
            if (!_exclusions.Contains(path))
            {
                _exclusions.Add(path);
                SaveExclusions();
            }
            return new { ok = true, exclusions = _exclusions.ToList() };
        }
    }

    public static object RemoveExclusion(string path)
    {
        lock (_exclLock)
        {
            EnsureExclusions();
            _exclusions.RemoveAll(x => string.Equals(x, path, StringComparison.OrdinalIgnoreCase));
            SaveExclusions();
            return new { ok = true, exclusions = _exclusions.ToList() };
        }
    }

    static bool IsExcluded(string path)
    {
        if (_exclusions.Count == 0) return false;
        try
        {
            string fileName = Path.GetFileName(path);
            foreach (var rule in _exclusions)
            {
                if (string.IsNullOrWhiteSpace(rule)) continue;
                if (rule.Contains('*') || rule.Contains('?'))
                {
                    if (GlobMatch(rule, path) || GlobMatch(rule, fileName)) return true;
                }
                else
                {
                    string r = rule.TrimEnd('\\', '/');
                    if (string.Equals(path, r, StringComparison.OrdinalIgnoreCase) ||
                        path.StartsWith(r + "\\", StringComparison.OrdinalIgnoreCase) ||
                        path.StartsWith(r + "/", StringComparison.OrdinalIgnoreCase))
                        return true;
                }
            }
        }
        catch { }
        return false;
    }

    static bool GlobMatch(string pattern, string text)
    {
        try
        {
            var regex = new System.Text.RegularExpressions.Regex(
                "^" + System.Text.RegularExpressions.Regex.Escape(pattern)
                    .Replace(@"\*", ".*").Replace(@"\?", ".") + "$",
                System.Text.RegularExpressions.RegexOptions.IgnoreCase);
            return regex.IsMatch(text);
        }
        catch { return false; }
    }

    // ============================ DUPLICATAS ============================

    public static object FindDuplicates(string root, long minSize = 1048576)
    {
        if (string.IsNullOrWhiteSpace(root) || !Directory.Exists(root))
            throw new Exception("pasta não encontrada: " + root);
        lock (_exclLock) EnsureExclusions();

        var bySize = new Dictionary<long, List<string>>();
        int scanned = 0;
        ulong totalBytes = 0;
        foreach (var f in EnumerateAllFiles(root))
        {
            try
            {
                var fi = new FileInfo(f);
                if (fi.Length < minSize || fi.Length == 0) continue;
                if (!bySize.TryGetValue(fi.Length, out var list))
                    bySize[fi.Length] = list = new List<string>();
                list.Add(f);
                scanned++;
                totalBytes += (ulong)fi.Length;
            }
            catch { }
        }

        // filtro rápido: hash parcial (primeiro + último 64KB) por grupo de tamanho
        var partialGroups = new Dictionary<string, List<string>>();
        foreach (var (size, files) in bySize)
        {
            if (files.Count < 2) continue;
            var sub = new Dictionary<string, List<string>>();
            foreach (var f in files)
            {
                string? h = PartialHash(f);
                if (h == null) continue;
                string key = size + "|" + h;
                if (!sub.TryGetValue(key, out var l)) sub[key] = l = new List<string>();
                l.Add(f);
            }
            foreach (var l in sub.Values)
                if (l.Count >= 2)
                    foreach (var f in l)
                        partialGroups[size + "|" + f] = new List<string> { f, size.ToString() };
        }

        // hash completo (SHA-256) só para os candidatos
        var fullGroups = new Dictionary<string, (List<string> files, long size)>();
        foreach (var entry in partialGroups)
        {
            string f = entry.Value[0];
            long size = long.Parse(entry.Value[1]);
            string? h = FullHash(f);
            if (h == null) continue;
            string key = size + "|" + h;
            if (!fullGroups.TryGetValue(key, out var g))
                fullGroups[key] = g = (new List<string>(), size);
            g.files.Add(f);
        }

        var groups = fullGroups.Values
            .Where(g => g.files.Count >= 2)
            .OrderByDescending(g => g.size * (g.files.Count - 1))
            .Take(500)
            .Select(g => new
            {
                size = (ulong)g.size,
                files = g.files.OrderBy(f => f, StringComparer.OrdinalIgnoreCase).ToList(),
                wasted = (ulong)(g.size * (g.files.Count - 1)),
            })
            .ToList();

        return new
        {
            root,
            scanned_files = scanned,
            scanned_bytes = totalBytes,
            groups,
        };
    }

    static IEnumerable<string> EnumerateAllFiles(string root)
    {
        var stack = new Stack<string>();
        stack.Push(root);
        while (stack.Count > 0)
        {
            string dir = stack.Pop();
            if (IsExcluded(dir)) continue;
            string[] files = Array.Empty<string>();
            try { files = Directory.GetFiles(dir); } catch { }
            foreach (var f in files)
            {
                if (IsExcluded(f)) continue;
                yield return f;
            }
            try
            {
                foreach (var d in Directory.GetDirectories(dir))
                    if (!IsExcluded(d)) stack.Push(d);
            }
            catch { }
        }
    }

    static string? PartialHash(string path)
    {
        try
        {
            const int chunk = 64 * 1024;
            var fi = new FileInfo(path);
            using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
            var data = new List<byte>(chunk * 2);
            var buf = new byte[chunk];
            int read = fs.Read(buf, 0, chunk);
            data.AddRange(buf.AsSpan(0, read).ToArray());
            if (fi.Length > chunk)
            {
                fs.Seek(-chunk, SeekOrigin.End);
                read = fs.Read(buf, 0, chunk);
                data.AddRange(buf.AsSpan(0, read).ToArray());
            }
            return Convert.ToHexString(MD5.HashData(data.ToArray()));
        }
        catch { return null; }
    }

    static string? FullHash(string path)
    {
        try
        {
            using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
            return Convert.ToHexString(SHA256.HashData(fs));
        }
        catch { return null; }
    }

    // ============================ SHREDDER ============================

    public static object DeleteFiles(string[] paths)
    {
        ulong freed = 0;
        int count = 0;
        var errors = new List<string>();
        lock (_exclLock) EnsureExclusions();
        foreach (var p in paths)
        {
            try
            {
                if (File.Exists(p))
                {
                    ulong len = (ulong)new FileInfo(p).Length;
                    new FileInfo(p).Delete();
                    freed += len;
                    count++;
                }
                else if (Directory.Exists(p))
                {
                    ulong size = 0; int files = 0;
                    Walk(p, null, ref size, ref files);
                    Directory.Delete(p, true);
                    freed += size;
                    count += files;
                }
                else errors.Add($"{p}: não encontrado");
            }
            catch (Exception ex)
            {
                errors.Add($"{p}: {ex.Message}");
            }
        }
        return new { deleted = count, freed_bytes = freed, errors };
    }

    public static object ShredPaths(string[] paths)
    {
        ulong freed = 0;
        int count = 0;
        var errors = new List<string>();
        lock (_exclLock) EnsureExclusions();
        foreach (var p in paths)
        {
            try
            {
                if (File.Exists(p))
                {
                    freed += (ulong)ShredFile(p);
                    count++;
                }
                else if (Directory.Exists(p))
                {
                    foreach (var f in EnumerateAllFiles(p))
                    {
                        try { freed += (ulong)ShredFile(f); count++; }
                        catch (Exception ex) { errors.Add($"{f}: {ex.Message}"); }
                    }
                    foreach (var d in Directory.EnumerateDirectories(p).Reverse())
                        try { Directory.Delete(d, true); } catch { }
                    try { Directory.Delete(p, true); } catch { }
                }
                else errors.Add($"{p}: não encontrado");
            }
            catch (Exception ex)
            {
                errors.Add($"{p}: {ex.Message}");
            }
        }
        return new { shredded = count, freed_bytes = freed, errors };
    }

    static long ShredFile(string path)
    {
        var fi = new FileInfo(path);
        long len = fi.Length;
        using (var fs = new FileStream(path, FileMode.Open, FileAccess.ReadWrite, FileShare.None))
        {
            var buf = new byte[1024 * 1024];
            long remaining = fs.Length;
            while (remaining > 0)
            {
                int chunk = (int)Math.Min(buf.Length, remaining);
                RandomNumberGenerator.Fill(buf.AsSpan(0, chunk));
                fs.Write(buf, 0, chunk);
                remaining -= chunk;
            }
            fs.Flush(flushToDisk: true);
        }
        try
        {
            string dir = Path.GetDirectoryName(path) ?? ".";
            string rnd = Path.Combine(dir, "___" + Guid.NewGuid().ToString("N")[..16]);
            File.Move(path, rnd);
            path = rnd;
        }
        catch { }
        try { File.Delete(path); } catch { }
        return len;
    }

    // ============================ MENU DE CONTEXTO ============================

    static (string label, string path)[] ContextMenuLocations =>
    new[]
    {
        ("Arquivos", @"*\shellex\ContextMenuHandlers"),
        ("Pastas", @"Directory\shellex\ContextMenuHandlers"),
        ("Fundo de pasta", @"Directory\Background\shellex\ContextMenuHandlers"),
        ("Todos os objetos", @"AllFileSystemObjects\shellex\ContextMenuHandlers"),
    };

    public static List<object> GetContextMenuHandlers()
    {
        var list = new List<(string name, string location, string key, string clsid, string dll, bool enabled, string reg_path)>();
        foreach (var (label, path) in ContextMenuLocations)
        {
            using var k = SafeOpen(Registry.ClassesRoot, path);
            if (k == null) continue;
            foreach (var sub in k.GetSubKeyNames())
            {
                using var sk = SafeOpen(k, sub);
                if (sk == null) continue;
                string def = sk.GetValue(null) as string ?? "";
                string clsid = def.TrimStart('-');
                string name = sub;
                string dll = "";
                if (clsid.StartsWith('{'))
                {
                    using var ck = SafeOpen(Registry.ClassesRoot, @"CLSID\" + clsid);
                    if (ck != null)
                    {
                        string cn = ck.GetValue(null) as string ?? "";
                        if (!string.IsNullOrWhiteSpace(cn)) name = cn;
                        using var ik = SafeOpen(ck, "InprocServer32");
                        dll = ik?.GetValue(null) as string ?? "";
                    }
                }
                bool enabled = !def.StartsWith('-');
                list.Add((name, label, sub, clsid, dll, enabled, $@"HKCR\{path}\{sub}"));
            }
        }
        return list
            .OrderBy(h => h.name, StringComparer.OrdinalIgnoreCase)
            .Select(h => (object)new { name = h.name, location = h.location, key = h.key, clsid = h.clsid, dll = h.dll, enabled = h.enabled, reg_path = h.reg_path })
            .ToList();
    }

    public static object ToggleContextMenuHandler(string location, string key, bool enable)
    {
        var loc = ContextMenuLocations.FirstOrDefault(l => l.label == location);
        if (loc.label == null) throw new Exception($"localização desconhecida: {location}");
        string fullPath = $@"{loc.path}\{key}";
        using var sk = SafeOpen(Registry.ClassesRoot, fullPath);
        string def = sk?.GetValue(null) as string ?? "";
        if (string.IsNullOrWhiteSpace(def)) throw new Exception("handler sem CLSID definido");

        var backups = new List<object>
        {
            new { key = $@"HKCR\{fullPath}", name = "(Padrão)", data = def, kind = SafeKind(sk!, null) },
        };
        SaveBackup("ctx_menu", backups);

        using var wk = OpenWritable(Registry.ClassesRoot, fullPath)
            ?? throw new Exception("acesso negado ao registro (execute como administrador)");
        string clsid = def.TrimStart('-');
        wk.SetValue(null, enable ? clsid : "-" + clsid);
        return new { ok = true };
    }

    // ============================ TAREFAS AGENDADAS (logon/boot) ============================

    public static List<object> GetScheduledTasksStartup()
    {
        string ps = "$ErrorActionPreference='SilentlyContinue'; " +
            "$t = @(Get-ScheduledTask | Where-Object { $_.Triggers | Where-Object { $_.CimClass.CimClassName -match 'MSFT_TaskLogonTrigger|MSFT_TaskBootTrigger' } } | " +
            "ForEach-Object { [pscustomobject]@{ name=$_.TaskName; tpath=$_.TaskPath; state=[string]$_.State; action=(($_.Actions | Select-Object -First 1).Execute) } }); " +
            "$t | ConvertTo-Json -Compress";
        string output = RunPowerShell(ps, 120000);
        var entries = new List<(string name, string tpath, string state, string action)>();
        if (string.IsNullOrWhiteSpace(output)) return new List<object>();
        try
        {
            using var doc = JsonDocument.Parse(output);
            if (doc.RootElement.ValueKind == JsonValueKind.Array)
            {
                foreach (var el in doc.RootElement.EnumerateArray()) AddTask(entries, el);
            }
            else if (doc.RootElement.ValueKind == JsonValueKind.Object)
            {
                AddTask(entries, doc.RootElement);
            }
        }
        catch (Exception ex)
        {
            throw new Exception("não foi possível interpretar a saída do PowerShell: " + ex.Message);
        }
        return entries
            .OrderBy(t => t.tpath, StringComparer.OrdinalIgnoreCase)
            .ThenBy(t => t.name, StringComparer.OrdinalIgnoreCase)
            .Select(t => (object)new { name = t.name, tpath = t.tpath, state = t.state, action = t.action })
            .ToList();
    }

    static void AddTask(List<(string name, string tpath, string state, string action)> entries, JsonElement el)
    {
        string name = el.TryGetProperty("name", out var n) ? n.GetString() ?? "" : "";
        string tpath = el.TryGetProperty("tpath", out var p) ? p.GetString() ?? "" : "";
        if (string.IsNullOrWhiteSpace(name)) return;
        entries.Add((
            name,
            tpath,
            el.TryGetProperty("state", out var s) ? s.GetString() ?? "" : "",
            el.TryGetProperty("action", out var a) ? a.GetString() ?? "" : ""
        ));
    }

    public static object ToggleScheduledTask(string tpath, string name, bool enable)
    {
        string verb = enable ? "Enable-ScheduledTask" : "Disable-ScheduledTask";
        string cmd = verb +
            $" -TaskPath '{tpath.Replace("'", "''")}' -TaskName '{name.Replace("'", "''")}' | Out-Null; if ($?) {{ 'OK' }} else {{ 'FALHOU' }}";
        string output = RunPowerShell(cmd, 60000);
        if (!output.Contains("OK"))
            throw new Exception("falha ao alterar a tarefa (tente executar como administrador)");
        return new { ok = true };
    }

    static string RunPowerShell(string command, int timeoutMs)
    {
        var psi = new ProcessStartInfo("powershell.exe",
            "-NoProfile -ExecutionPolicy Bypass -Command \"" + command.Replace("\"", "\\\"") + "\"")
        {
            CreateNoWindow = true,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        using var p = Process.Start(psi) ?? throw new Exception("não foi possível iniciar o PowerShell");
        string output = p.StandardOutput.ReadToEnd();
        string err = p.StandardError.ReadToEnd();
        p.WaitForExit(timeoutMs);
        if (!string.IsNullOrWhiteSpace(err) && string.IsNullOrWhiteSpace(output))
            throw new Exception(err.Trim());
        return output.Trim();
    }

    // ============================ HEALTH CHECK ============================

    public static object RunHealthCheck(Action<object> onProgress)
    {
        var selected = BuildCategories().Select(c => c.id).ToList();
        var (scanned, totalSize, totalCount) = ScanCategories(selected, onProgress, CancellationToken.None).GetAwaiter().GetResult();

        ulong junkSize = 0;
        int junkCount = 0;
        int regIssues = 0;
        foreach (var cat in scanned)
        {
            foreach (var it in cat.items)
            {
                if (it.is_registry) regIssues += it.count;
                else { junkSize += it.size; junkCount += it.count; }
            }
        }
        int startupCount = CountEnabledStartup();

        int score = 100
            - Math.Min(35, (int)(junkSize / (1024L * 1024 * 1024)) * 5)
            - Math.Min(30, regIssues)
            - Math.Max(0, (startupCount - 5) * 2);
        score = Math.Clamp(score, 5, 100);
        string label = score >= 85 ? "Excelente" : score >= 65 ? "Bom" : score >= 40 ? "Atenção" : "Crítico";

        var issues = new List<object>();
        issues.Add(new
        {
            id = "junk",
            name = "Arquivos desnecessários",
            detail = $"{junkCount} arquivos ocupando {FormatBytes(junkSize)}",
            severity = junkSize > 1024UL * 1024 * 1024 ? "warn" : "info",
            fixable = true,
        });
        issues.Add(new
        {
            id = "registry",
            name = "Registro",
            detail = regIssues == 0 ? "nenhum problema encontrado" : $"{regIssues} entradas órfãs",
            severity = regIssues > 0 ? "warn" : "info",
            fixable = true,
        });
        issues.Add(new
        {
            id = "startup",
            name = "Inicialização",
            detail = $"{startupCount} programas ativos",
            severity = startupCount > 8 ? "warn" : "info",
            fixable = false,
        });

        return new
        {
            score,
            label,
            junk_size = junkSize,
            junk_count = junkCount,
            registry_issues = regIssues,
            startup_count = startupCount,
            issues,
            scan = new { categories = scanned, total_size = totalSize, total_count = totalCount },
        };
    }

    static string FormatBytes(ulong b)
    {
        string[] units = { "B", "KB", "MB", "GB", "TB" };
        double v = b; int i = 0;
        while (v >= 1024 && i < units.Length - 1) { v /= 1024; i++; }
        return $"{v:0.#} {units[i]}";
    }
}