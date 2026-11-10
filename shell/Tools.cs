using Microsoft.Win32;
using System.Collections.Concurrent;
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
            bool safeDirectory;
            try { safeDirectory = !IsExcluded(dir) && (File.GetAttributes(dir) & FileAttributes.ReparsePoint) == 0; }
            catch { continue; }
            if (!safeDirectory) continue;

            string[] files;
            try { files = Directory.GetFiles(dir); } catch { files = Array.Empty<string>(); }
            foreach (var f in files)
            {
                bool safeFile;
                try { safeFile = !IsExcluded(f) && (File.GetAttributes(f) & FileAttributes.ReparsePoint) == 0; }
                catch { continue; }
                if (safeFile) yield return f;
            }

            string[] directories;
            try { directories = Directory.GetDirectories(dir); } catch { directories = Array.Empty<string>(); }
            foreach (var d in directories)
            {
                try
                {
                    if (!IsExcluded(d) && (File.GetAttributes(d) & FileAttributes.ReparsePoint) == 0)
                        stack.Push(d);
                }
                catch { }
            }
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

    static bool IsWithinPath(string path, string root)
    {
        try
        {
            string fullPath = Path.GetFullPath(path).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            string fullRoot = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            return string.Equals(fullPath, fullRoot, StringComparison.OrdinalIgnoreCase) ||
                   fullPath.StartsWith(fullRoot + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);
        }
        catch { return false; }
    }

    static string ValidateManualDeletePath(string path)
    {
        if (string.IsNullOrWhiteSpace(path)) throw new Exception("caminho vazio");
        string full = Path.GetFullPath(path);
        string volumeRoot = Path.GetPathRoot(full) ?? "";
        if (string.Equals(full.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar),
            volumeRoot.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar), StringComparison.OrdinalIgnoreCase))
            throw new Exception("não é permitido excluir uma unidade inteira");
        if (!File.Exists(full) && !Directory.Exists(full)) throw new FileNotFoundException("caminho não encontrado", full);
        if ((File.GetAttributes(full) & FileAttributes.ReparsePoint) != 0)
            throw new Exception("links simbólicos, junctions e outros reparse points não são aceitos");
        if (IsExcluded(full)) throw new Exception("caminho protegido por uma exclusão configurada");

        string[] protectedRoots =
        {
            Environment.GetFolderPath(Environment.SpecialFolder.Windows),
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
        };
        if (protectedRoots.Any(root => !string.IsNullOrWhiteSpace(root) &&
            (IsWithinPath(full, root) || IsWithinPath(root, full))))
            throw new Exception("caminho em, ou contendo, uma pasta protegida do Windows/aplicativos");

        string userProfile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        if (!string.IsNullOrWhiteSpace(userProfile) && IsWithinPath(userProfile, full))
            throw new Exception("não é permitido excluir a pasta raiz do perfil nem uma pasta que a contenha");
        return full;
    }

    static void DeleteManualPath(string path, bool shred, ref ulong freed, ref int count, List<string> errors)
    {
        if (IsExcluded(path)) return;
        FileAttributes attributes;
        try { attributes = File.GetAttributes(path); }
        catch (Exception ex) { errors.Add($"{path}: {ex.Message}"); return; }
        if ((attributes & FileAttributes.ReparsePoint) != 0)
        {
            errors.Add($"{path}: link/reparse point ignorado por segurança");
            return;
        }

        if ((attributes & FileAttributes.Directory) == 0)
        {
            try
            {
                ulong size = (ulong)new FileInfo(path).Length;
                if (shred) ShredFile(path); else File.Delete(path);
                freed += size;
                count++;
            }
            catch (Exception ex) { errors.Add($"{path}: {ex.Message}"); }
            return;
        }

        try
        {
            foreach (string file in Directory.EnumerateFiles(path))
                DeleteManualPath(file, shred, ref freed, ref count, errors);
        }
        catch (Exception ex) { errors.Add($"{path}: {ex.Message}"); }
        try
        {
            foreach (string directory in Directory.EnumerateDirectories(path))
                DeleteManualPath(directory, shred, ref freed, ref count, errors);
        }
        catch (Exception ex) { errors.Add($"{path}: {ex.Message}"); }
        try { Directory.Delete(path, false); }
        catch (Exception ex) { errors.Add($"{path}: pasta não removida ({ex.Message})"); }
    }

    public static object DeleteFiles(string[] paths)
    {
        ulong freed = 0;
        int count = 0;
        var errors = new List<string>();
        lock (_exclLock) EnsureExclusions();
        foreach (var path in paths.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            try { DeleteManualPath(ValidateManualDeletePath(path), shred: false, ref freed, ref count, errors); }
            catch (Exception ex) { errors.Add($"{path}: {ex.Message}"); }
        }
        return new { deleted = count, freed_bytes = freed, errors };
    }

    public static object ShredPaths(string[] paths)
    {
        ulong freed = 0;
        int count = 0;
        var errors = new List<string>();
        lock (_exclLock) EnsureExclusions();
        foreach (var path in paths.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            try { DeleteManualPath(ValidateManualDeletePath(path), shred: true, ref freed, ref count, errors); }
            catch (Exception ex) { errors.Add($"{path}: {ex.Message}"); }
        }
        return new { shredded = count, freed_bytes = freed, errors };
    }

    static long ShredFile(string path)
    {
        if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
            throw new IOException("não é permitido triturar links simbólicos ou reparse points");
        var fi = new FileInfo(path);
        long len = fi.Length;
        using (var fs = new FileStream(path, FileMode.Open, FileAccess.ReadWrite, FileShare.None, 1024 * 1024, FileOptions.WriteThrough))
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
        File.Delete(path);
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

    // ============================ TURBO BOOST (Advanced SystemCare) ============================

    static readonly string[] TurboServices = new[] { "SysMain", "DiagTrack", "WSearch", "MapsBroker" };
    static readonly ConcurrentDictionary<string, bool> _turboPreviousState = new();
    static bool _turboBoostActive = false;

    public static object GetTurboBoostStatus()
    {
        return new { active = _turboBoostActive, services = TurboServices };
    }

    public static object ToggleTurboBoost(bool enable)
    {
        int modified = 0;
        if (enable)
        {
            _turboPreviousState.Clear();
            foreach (var svc in TurboServices)
            {
                try
                {
                    var status = RunPowerShell($"(Get-Service -Name '{svc}' -ErrorAction SilentlyContinue).Status", 5000);
                    if (status.Contains("Running", StringComparison.OrdinalIgnoreCase))
                    {
                        _turboPreviousState[svc] = true;
                        RunPowerShell($"Stop-Service -Name '{svc}' -Force -ErrorAction SilentlyContinue", 10000);
                        modified++;
                    }
                }
                catch { }
            }
            try { OptimizeMemory(); } catch { }
            _turboBoostActive = true;
        }
        else
        {
            foreach (var kvp in _turboPreviousState)
            {
                if (kvp.Value)
                {
                    try
                    {
                        RunPowerShell($"Start-Service -Name '{kvp.Key}' -ErrorAction SilentlyContinue", 10000);
                        modified++;
                    }
                    catch { }
                }
            }
            _turboPreviousState.Clear();
            _turboBoostActive = false;
        }
        return new { ok = true, active = _turboBoostActive, count = modified };
    }

    // ============================ ATALHOS QUEBRADOS ============================

    public static List<object> ScanBrokenShortcuts()
    {
        var list = new List<object>();
        var folders = new List<string>();

        void AddIfExists(Environment.SpecialFolder f)
        {
            try { var p = Environment.GetFolderPath(f); if (Directory.Exists(p)) folders.Add(p); } catch { }
        }

        AddIfExists(Environment.SpecialFolder.Desktop);
        AddIfExists(Environment.SpecialFolder.CommonDesktopDirectory);
        AddIfExists(Environment.SpecialFolder.StartMenu);
        AddIfExists(Environment.SpecialFolder.CommonStartMenu);

        try
        {
            var userPrograms = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), @"Microsoft\Windows\Start Menu\Programs");
            if (Directory.Exists(userPrograms)) folders.Add(userPrograms);
            var commonPrograms = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), @"Microsoft\Windows\Start Menu\Programs");
            if (Directory.Exists(commonPrograms)) folders.Add(commonPrograms);
        }
        catch { }

        Type? shellType = Type.GetTypeFromProgID("WScript.Shell");
        if (shellType == null) return list;
        dynamic? shell = null;
        try { shell = Activator.CreateInstance(shellType); } catch { return list; }
        if (shell == null) return list;

        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var dir in folders.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            try
            {
                foreach (var file in Directory.EnumerateFiles(dir, "*.lnk", SearchOption.AllDirectories))
                {
                    if (!seen.Add(file)) continue;
                    try
                    {
                        dynamic sc = shell.CreateShortcut(file);
                        string target = (string)sc.TargetPath;
                        if (string.IsNullOrWhiteSpace(target)) continue;

                        if (target.StartsWith("::") || target.StartsWith("ms-", StringComparison.OrdinalIgnoreCase)) continue;

                        bool isDir = string.IsNullOrEmpty(Path.GetExtension(target));
                        bool exists = isDir ? Directory.Exists(target) : File.Exists(target);

                        if (!exists)
                        {
                            list.Add(new
                            {
                                path = file,
                                name = Path.GetFileNameWithoutExtension(file),
                                target,
                                folder = Path.GetDirectoryName(file) ?? ""
                            });
                        }
                    }
                    catch { }
                }
            }
            catch { }
        }

        return list;
    }

    public static object DeleteBrokenShortcuts(string[] paths)
    {
        int deleted = 0;
        var errors = new List<string>();
        foreach (var p in paths)
        {
            try
            {
                if (File.Exists(p) && p.EndsWith(".lnk", StringComparison.OrdinalIgnoreCase))
                {
                    File.Delete(p);
                    deleted++;
                }
            }
            catch (Exception ex)
            {
                errors.Add($"{Path.GetFileName(p)}: {ex.Message}");
            }
        }
        return new { ok = true, deleted, errors };
    }

    // ============================ SSD TRIM ============================

    public static object OptimizeSsdTrim()
    {
        try
        {
            string output = RunPowerShell("Optimize-Volume -DriveLetter C -ReTrim -Verbose", 60000);
            return new { ok = true, message = "Comando TRIM executado com sucesso na unidade C:", output };
        }
        catch (Exception ex)
        {
            return new { ok = false, message = "Falha ao executar TRIM: " + ex.Message };
        }
    }
}