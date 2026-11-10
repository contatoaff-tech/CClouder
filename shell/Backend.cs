using Microsoft.Win32;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO;
using System.Text.Json;

namespace CClouder;

public static partial class Backend
{
    public static CancellationTokenSource? ScanCts;

    const string SharedDllsPath = @"SOFTWARE\Microsoft\Windows\CurrentVersion\SharedDLLs";
    const string UninstallPath = @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall";
    const string Uninstall32Path = @"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall";
    const string FontsPath = @"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts";
    const string AppPathsPath = @"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths";
    const string RunMruPath = @"Software\Microsoft\Windows\CurrentVersion\Explorer\RunMRU";
    const string StorePath = @"Software\CClouder\StartupDisabled";
    const string BackupDirName = "CClouderBackups";

    readonly record struct RegBase(RegistryKey Hive, string Label, string Path);

    static readonly RegBase[] UninstallBases =
    {
        new(Registry.LocalMachine, "HKLM", UninstallPath),
        new(Registry.LocalMachine, "HKLM", Uninstall32Path),
        new(Registry.CurrentUser, "HKCU", @"Software\Microsoft\Windows\CurrentVersion\Uninstall"),
    };

    static (string label, RegistryKey hive, string sub)[] RunLocations =>
    new[]
    {
        ("HKCU\\Run", Registry.CurrentUser, @"Software\Microsoft\Windows\CurrentVersion\Run"),
        ("HKCU\\RunOnce", Registry.CurrentUser, @"Software\Microsoft\Windows\CurrentVersion\RunOnce"),
        ("HKLM\\Run", Registry.LocalMachine, @"SOFTWARE\Microsoft\Windows\CurrentVersion\Run"),
        ("HKLM\\RunOnce", Registry.LocalMachine, @"SOFTWARE\Microsoft\Windows\CurrentVersion\RunOnce"),
        ("HKLM32\\Run", Registry.LocalMachine, @"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Run"),
        ("HKLM32\\RunOnce", Registry.LocalMachine, @"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\RunOnce"),
    };

    // ============================ MODELOS (JSON snake_case) ============================

    public sealed class Item
    {
        public string id { get; set; } = "";
        public string name { get; set; } = "";
        public string path { get; set; } = "";
        public ulong size { get; set; }
        public int count { get; set; }
        public bool @checked { get; set; }
        public bool is_registry { get; set; }
    }

    public sealed class Category
    {
        public string id { get; set; } = "";
        public string name { get; set; } = "";
        public string description { get; set; } = "";
        public bool @checked { get; set; }
        public List<Item> items { get; set; } = new();
    }

    static Item It(string id, string name, string path, bool chk = true, bool reg = false) =>
        new() { id = id, name = name, path = path, @checked = chk, is_registry = reg };

    static Category Cat(string id, string name, string description, bool chk, params Item[] items) =>
        new() { id = id, name = name, description = description, @checked = chk, items = items.ToList() };

    public static List<Category> BuildCategories() => new()
    {
        Cat("system", "Sistema", "Arquivos temporários, logs, relatórios de erro", true,
            It("temp", "Arquivos Temporários", "%TEMP%"),
            It("tmp", "Pasta TMP", "%TMP%"),
            It("prefetch", "Prefetch", "%WINDIR%\\Prefetch"),
            It("recent", "Documentos Recentes", "%APPDATA%\\Microsoft\\Windows\\Recent"),
            It("memory_dumps", "Memory Dumps", "%WINDIR%\\Minidump", false),
            It("chkdsk", "Fragmentos Chkdsk", "%WINDIR%\\*.chk", false),
            It("windows_logs", "Logs do Windows", "%WINDIR%\\Logs"),
            It("error_reports", "Relatórios de Erro", "%LOCALAPPDATA%\\Microsoft\\Windows\\WER")),

        Cat("browser", "Navegadores", "Cache, cookies, histórico, sessões", true,
            It("edge_cache", "Edge Cache", "%LOCALAPPDATA%\\Microsoft\\Edge\\User Data\\Default\\Cache"),
            It("edge_cookies", "Edge Cookies", "%LOCALAPPDATA%\\Microsoft\\Edge\\User Data\\Default\\Network", false),
            It("chrome_cache", "Chrome Cache", "%LOCALAPPDATA%\\Google\\Chrome\\User Data\\Default\\Cache"),
            It("chrome_cookies", "Chrome Cookies", "%LOCALAPPDATA%\\Google\\Chrome\\User Data\\Default\\Network", false),
            It("firefox_cache", "Firefox Cache (somente cache)", "Perfis do Firefox\\cache2"),
            It("brave_cache", "Brave Cache", "%LOCALAPPDATA%\\BraveSoftware\\Brave-Browser\\User Data\\Default\\Cache"),
            It("opera_cache", "Opera Cache", "%APPDATA%\\Opera Software\\Opera Stable\\Cache")),

        Cat("apps", "Aplicativos", "Caches de apps comuns", true,
            It("spotify_cache", "Spotify Cache", "%APPDATA%\\Spotify\\Storage"),
            It("discord_cache", "Discord Cache", "%APPDATA%\\discord\\Cache"),
            It("steam_cache", "Steam Cache", "%PROGRAMFILES(X86)%\\Steam\\appcache"),
            It("vs_cache", "VS Code Cache", "%APPDATA%\\Code\\Cache"),
            It("teams_cache", "Teams Cache", "%APPDATA%\\Microsoft\\Teams\\Cache"),
            It("adobe_cache", "Adobe Cache", "%APPDATA%\\Adobe\\Common\\Media Cache"),
            It("nvidia_cache", "NVIDIA Cache", "%TEMP%\\NVIDIA")),

        Cat("registry", "Registro", "Chaves órfãs, extensões inválidas, MRUs", false,
            It("reg_uninstall", "Desinstaladores Órfãos", "HKLM Uninstall", true, true),
            It("reg_shared", "DLLs Compartilhadas", "HKLM SharedDLLs", true, true),
            It("reg_com", "COM/ActiveX", "HKCR CLSID", true, true),
            It("reg_file_ext", "Extensões de Arquivo", "HKCR Extensions", true, true),
            It("reg_mru", "Listas MRU", "HKCU RunMRU", false, true),
            It("reg_fonts", "Fontes", "HKLM Fonts", true, true),
            It("reg_help", "App Paths", "HKLM App Paths", true, true)),

        Cat("advanced", "Avançado", "Itens que exigem cuidado", false,
            It("old_prefetch", "Prefetch Antigo (>30 dias)", "%WINDIR%\\Prefetch", false),
            It("windows_update", "Windows Update Cleanup", "%WINDIR%\\SoftwareDistribution\\Download", false),
            It("thumbnails", "Thumbnails", "%LOCALAPPDATA%\\Microsoft\\Windows\\Explorer"),
            It("icon_cache", "Icon Cache", "%LOCALAPPDATA%\\IconCache.db"),
            It("dns_cache", "DNS Cache (flushdns)", "flushdns", false)),
    };

    // ============================ VARIAVEIS DE AMBIENTE ============================

    public static string ExpandEnv(string p)
    {
        var windir = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
        var pairs = new (string k, string v)[]
        {
            ("%TEMP%", Environment.GetEnvironmentVariable("TEMP") ?? ""),
            ("%TMP%", Environment.GetEnvironmentVariable("TMP") ?? ""),
            ("%LOCALAPPDATA%", Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData)),
            ("%APPDATA%", Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData)),
            ("%WINDIR%", windir),
            ("%SYSTEMROOT%", windir),
            ("%USERPROFILE%", Environment.GetFolderPath(Environment.SpecialFolder.UserProfile)),
            ("%PROGRAMFILES(X86)%", Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86)),
        };
        foreach (var (k, v) in pairs)
            if (!string.IsNullOrEmpty(v)) p = p.Replace(k, v);
        return p;
    }

    static List<string> FirefoxCacheDirectories() => FirefoxCacheDirectories(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData));

    internal static List<string> FirefoxCacheDirectories(string roaming, string local)
    {
        var firefoxRoaming = Path.Combine(roaming, "Mozilla", "Firefox");
        var profileDirs = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        void AddProfile(string path, bool relative)
        {
            try
            {
                string candidate = relative ? Path.Combine(firefoxRoaming, path) : Environment.ExpandEnvironmentVariables(path);
                candidate = Path.GetFullPath(candidate);
                if (Directory.Exists(candidate) && (File.GetAttributes(candidate) & FileAttributes.ReparsePoint) == 0)
                    profileDirs.Add(candidate);
            }
            catch (Exception ex) { Diag.Swallow("Backend/#1", ex); }
        }

        // Firefox keeps profile locations in profiles.ini; cache2 itself is the
        // only directory this cleaner may touch (never the profile root).
        string profilesIni = Path.Combine(firefoxRoaming, "profiles.ini");
        try
        {
            if (File.Exists(profilesIni))
            {
                bool inProfile = false, relative = true;
                string profilePath = "";
                void AddCurrentProfile()
                {
                    if (inProfile && !string.IsNullOrWhiteSpace(profilePath)) AddProfile(profilePath, relative);
                }

                foreach (string raw in File.ReadLines(profilesIni))
                {
                    string line = raw.Trim();
                    if (line.StartsWith('[') && line.EndsWith(']'))
                    {
                        AddCurrentProfile();
                        string section = line[1..^1];
                        inProfile = section.StartsWith("Profile", StringComparison.OrdinalIgnoreCase);
                        profilePath = "";
                        relative = true;
                        continue;
                    }
                    if (!inProfile) continue;
                    int equals = line.IndexOf('=');
                    if (equals <= 0) continue;
                    string key = line[..equals].Trim();
                    string value = line[(equals + 1)..].Trim();
                    if (key.Equals("Path", StringComparison.OrdinalIgnoreCase)) profilePath = value;
                    else if (key.Equals("IsRelative", StringComparison.OrdinalIgnoreCase))
                        relative = value == "1" || value.Equals("true", StringComparison.OrdinalIgnoreCase);
                }
                AddCurrentProfile();
            }
        }
        catch (Exception ex) { Diag.Swallow("Backend/#2", ex); }

        // Also discover profiles when profiles.ini is absent or incomplete.
        foreach (string root in new[]
        {
            Path.Combine(firefoxRoaming, "Profiles"),
            Path.Combine(local, "Mozilla", "Firefox", "Profiles"),
        })
        {
            try
            {
                if (Directory.Exists(root))
                    foreach (string profile in Directory.EnumerateDirectories(root))
                        AddProfile(profile, relative: false);
            }
            catch (Exception ex) { Diag.Swallow("Backend/#3", ex); }
        }

        var caches = new List<string>();
        foreach (string profile in profileDirs)
        {
            try
            {
                string cache = Path.Combine(profile, "cache2");
                if (!Directory.Exists(cache)) continue;
                if ((File.GetAttributes(cache) & FileAttributes.ReparsePoint) != 0) continue;
                caches.Add(cache);
            }
            catch (Exception ex) { Diag.Swallow("Backend/#4", ex); }
        }
        return caches;
    }

    static (ulong size, int count) ScanFirefoxCache()
    {
        ulong size = 0;
        int count = 0;
        foreach (string cache in FirefoxCacheDirectories()) Walk(cache, null, ref size, ref count);
        return (size, count);
    }

    internal static (ulong size, int count) CleanFirefoxCache()
    {
        ulong size = 0;
        int count = 0;
        foreach (string cache in FirefoxCacheDirectories()) CleanWalk(cache, null, ref size, ref count);
        return (size, count);
    }

    // ============================ SCAN ============================

    public static async Task<object> RunScan(Action<object> onProgress, Action<object> onComplete,
        List<string> selected, CancellationToken ct)
    {
        await Task.Yield();
        var (scanned, totalSize, totalCount) = await ScanCategories(selected, onProgress, ct);
        var result = new { categories = scanned, total_size = totalSize, total_count = totalCount };
        onComplete(result);
        return result;
    }

    static async Task<(List<Category> scanned, ulong totalSize, int totalCount)> ScanCategories(
        List<string> selected, Action<object> onProgress, CancellationToken ct)
    {
        await Task.Yield();
        lock (_exclLock) EnsureExclusions();
        var cats = BuildCategories().Where(c => selected.Contains(c.id)).ToList();
        ulong totalSize = 0;
        int totalCount = 0;
        int total = Math.Max(cats.Count, 1);
        var scanned = new List<Category>();

        for (int i = 0; i < cats.Count; i++)
        {
            ct.ThrowIfCancellationRequested();
            var cat = cats[i];
            onProgress(new { current_category = cat.name, category_id = cat.id, progress = (double)i / total, found_size = totalSize, found_count = totalCount });
            foreach (var item in cat.items)
            {
                ct.ThrowIfCancellationRequested();
                var (size, count) = ScanItem(item);
                item.size = size;
                item.count = count;
                totalSize += size;
                totalCount += count;
            }
            scanned.Add(cat);
        }
        return (scanned, totalSize, totalCount);
    }

    internal static (ulong, int) ScanItem(Item it)
    {
        if (it.id == "firefox_cache") return ScanFirefoxCache();
        if (it.is_registry) return RegistryCount(it.id);
        if (it.id == "dns_cache") return (0, 0);
        string path = ExpandEnv(it.path);
        DateTime? cutoff = it.id == "old_prefetch" ? DateTime.Now.AddDays(-30) : null;
        try
        {
            if (path.Contains('*'))
            {
                string dir = Path.GetDirectoryName(path) ?? path;
                string pattern = Path.GetFileName(path);
                if (!Directory.Exists(dir)) return (0, 0);
                ulong size = 0; int count = 0;
                foreach (var f in Directory.GetFiles(dir, pattern))
                    AddFile(f, cutoff, ref size, ref count);
                return (size, count);
            }
            if (File.Exists(path)) { var fi = new FileInfo(path); return ((ulong)fi.Length, 1); }
            if (Directory.Exists(path))
            {
                ulong size = 0; int count = 0;
                Walk(path, cutoff, ref size, ref count);
                return (size, count);
            }
        }
        catch (Exception ex) { Diag.Swallow("Backend/#7", ex); }
        return (0, 0);
    }

    static void AddFile(string f, DateTime? cutoff, ref ulong size, ref int count)
    {
        try
        {
            if (IsExcluded(f)) return;
            var fi = new FileInfo(f);
            if (cutoff.HasValue && fi.LastWriteTime > cutoff.Value) return;
            size += (ulong)fi.Length;
            count++;
        }
        catch (Exception ex) { Diag.Swallow("Backend/#8", ex); }
    }

    static void Walk(string dir, DateTime? cutoff, ref ulong size, ref int count)
    {
        try
        {
            foreach (var f in Directory.EnumerateFiles(dir))
                AddFile(f, cutoff, ref size, ref count);
            foreach (var d in Directory.EnumerateDirectories(dir))
            {
                if (IsExcluded(d) || (File.GetAttributes(d) & FileAttributes.ReparsePoint) != 0) continue;
                Walk(d, cutoff, ref size, ref count);
            }
        }
        catch (Exception ex) { Diag.Swallow("Backend/#9", ex); }
    }

    // ============================ LIMPEZA DE ARQUIVOS ============================

    internal static Item? ResolveCleanItem(string id)
    {
        var definition = BuildCategories().SelectMany(c => c.items)
            .FirstOrDefault(i => i.id.Equals(id, StringComparison.OrdinalIgnoreCase));
        return definition == null ? null : new Item
        {
            id = definition.id,
            name = definition.name,
            path = definition.path,
            is_registry = definition.is_registry,
        };
    }

    internal static object CleanSelected(JsonElement payload)
    {
        ulong freed = 0;
        int freedCount = 0;
        var errors = new List<string>();
        lock (_exclLock) EnsureExclusions();
        if (payload.TryGetProperty("items", out var items) && items.ValueKind == JsonValueKind.Array)
        {
            foreach (var el in items.EnumerateArray())
            {
                if (!(el.TryGetProperty("checked", out var c) && c.ValueKind == JsonValueKind.True && c.GetBoolean())) continue;
                string id = el.TryGetProperty("id", out var idElement) && idElement.ValueKind == JsonValueKind.String
                    ? idElement.GetString() ?? "" : "";
                var it = ResolveCleanItem(id);
                if (it == null)
                {
                    errors.Add($"item desconhecido: {id}");
                    continue;
                }
                try
                {
                    var (b, n) = CleanItem(it);
                    freed += b;
                    freedCount += n;
                }
                catch (Exception ex)
                {
                    errors.Add($"{it.name}: {ex.Message}");
                }
            }
        }
        return new { freed_bytes = freed, freed_count = freedCount, errors };
    }

    internal static (ulong, int) CleanItem(Item it)
    {
        if (it.id == "firefox_cache") return CleanFirefoxCache();
        if (it.is_registry) return RegistryClean(it.id);
        if (it.id == "dns_cache") { FlushDns(); return (0, 1); }
        string path = ExpandEnv(it.path);
        DateTime? cutoff = it.id == "old_prefetch" ? DateTime.Now.AddDays(-30) : null;
        ulong freed = 0; int count = 0;
        try
        {
            if (path.Contains('*'))
            {
                string dir = Path.GetDirectoryName(path) ?? path;
                string pattern = Path.GetFileName(path);
                if (Directory.Exists(dir))
                    foreach (var f in Directory.GetFiles(dir, pattern))
                        DeleteFile(f, cutoff, ref freed, ref count);
                return (freed, count);
            }
            if (File.Exists(path)) { DeleteFile(path, null, ref freed, ref count); return (freed, count); }
            if (Directory.Exists(path)) { CleanWalk(path, cutoff, ref freed, ref count); return (freed, count); }
        }
        catch (Exception ex) { Diag.Swallow("Backend/#11", ex); }
        return (freed, count);
    }

    static void DeleteFile(string f, DateTime? cutoff, ref ulong freed, ref int count)
    {
        try
        {
            if (IsExcluded(f)) return;
            var fi = new FileInfo(f);
            if (cutoff.HasValue && fi.LastWriteTime > cutoff.Value) return;
            ulong len = (ulong)fi.Length;
            fi.Delete();
            freed += len;
            count++;
        }
        catch (Exception ex) { Diag.Swallow("Backend/#12", ex); }
    }

    internal static void CleanWalk(string dir, DateTime? cutoff, ref ulong freed, ref int count)
    {
        try
        {
            foreach (var f in Directory.EnumerateFiles(dir))
                DeleteFile(f, cutoff, ref freed, ref count);
            foreach (var d in Directory.EnumerateDirectories(dir))
            {
                if (IsExcluded(d) || (File.GetAttributes(d) & FileAttributes.ReparsePoint) != 0) continue;
                CleanWalk(d, cutoff, ref freed, ref count);
                try { Directory.Delete(d, false); } catch (Exception ex) { Diag.Swallow("Backend/#13", ex); }
            }
        }
        catch (Exception ex) { Diag.Swallow("Backend/#14", ex); }
    }

    static void FlushDns()
    {
        try
        {
            var psi = new ProcessStartInfo("ipconfig", "/flushdns") { CreateNoWindow = true, UseShellExecute = false };
            using var p = Process.Start(psi);
            p?.WaitForExit(5000);
        }
        catch (Exception ex) { Diag.Swallow("Backend/#12", ex); }
    }

    // ============================ REGISTRO ============================

    static (ulong, int) S(int n) => ((ulong)n * 512, n);

    static (ulong, int) RegistryCount(string id) => id switch
    {
        "reg_shared" => S(SharedOrphanNames().Count),
        "reg_uninstall" => S(OrphanUninstallSubkeys().Count),
        "reg_com" => S(OrphanClsidNames().Count),
        "reg_file_ext" => S(OrphanExtensionNames().Count),
        "reg_mru" => S(RunMruOrphanNames().Count),
        "reg_fonts" => S(FontOrphanNames().Count),
        "reg_help" => S(OrphanAppPathNames().Count),
        _ => (0, 0),
    };

    static (ulong, int) RegistryClean(string id) => id switch
    {
        "reg_shared" => CleanSharedDlls(),
        "reg_uninstall" => CleanUninstall(),
        "reg_com" => CleanClsid(),
        "reg_file_ext" => CleanExtensions(),
        "reg_mru" => CleanRunMru(),
        "reg_fonts" => CleanFonts(),
        "reg_help" => CleanAppPaths(),
        _ => (0, 0),
    };

    static RegistryKey? SafeOpen(RegistryKey hive, string path)
    {
        try { return hive.OpenSubKey(path); } catch { return null; }
    }

    static RegistryKey? OpenWritable(RegistryKey hive, string path)
    {
        try { return hive.OpenSubKey(path, writable: true); } catch { return null; }
    }

    static string SafeKind(RegistryKey k, string name)
    {
        try { return k.GetValueKind(name).ToString(); } catch { return "Unknown"; }
    }

    static string ExtractExe(string v)
    {
        v = v.Trim();
        if (v.StartsWith('"'))
        {
            int end = v.IndexOf('"', 1);
            if (end > 0) return v.Substring(1, end - 1);
        }
        int i1 = v.IndexOf(" -", StringComparison.Ordinal);
        int i2 = v.IndexOf(" /", StringComparison.Ordinal);
        int cut = -1;
        if (i1 > 0 && i2 > 0) cut = Math.Min(i1, i2);
        else if (i1 > 0) cut = i1;
        else if (i2 > 0) cut = i2;
        if (cut > 0) v = v[..cut];
        return v.Trim();
    }

    static void SaveBackup(string id, List<object> entries)
    {
        try
        {
            if (entries.Count == 0) return;
            string dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), BackupDirName);
            Directory.CreateDirectory(dir);
            string file = Path.Combine(dir, $"backup-{DateTime.Now:yyyyMMdd-HHmmss}-{id}.json");
            File.WriteAllText(file, JsonSerializer.Serialize(entries));
        }
        catch (Exception ex) { Diag.Swallow("Backend/#13", ex); }
    }

    static string FullName(RegBase b, string sub) => $@"{b.Label}\{b.Path}\{sub}";

    // ---- SharedDLLs ----
    static List<string> SharedOrphanNames()
    {
        var names = new List<string>();
        using var k = SafeOpen(Registry.LocalMachine, SharedDllsPath);
        if (k == null) return names;
        foreach (var name in k.GetValueNames())
            if (!File.Exists(ExpandEnv(name))) names.Add(name);
        return names;
    }

    static (ulong, int) CleanSharedDlls()
    {
        var names = SharedOrphanNames();
        if (names.Count == 0) return (0, 0);
        using var k = OpenWritable(Registry.LocalMachine, SharedDllsPath)
            ?? throw new Exception("acesso negado ao registro (execute como administrador)");
        var backups = new List<object>();
        int n = 0;
        foreach (var name in names)
        {
            backups.Add(new { key = $@"HKLM\{SharedDllsPath}", name, data = k.GetValue(name), kind = SafeKind(k, name) });
            try { k.DeleteValue(name, false); n++; } catch (Exception ex) { Diag.Swallow("Backend/#14", ex); }
        }
        SaveBackup("reg_shared", backups);
        return S(n);
    }

    // ---- Desinstaladores órfãos ----
    static List<(RegBase b, string sub)> OrphanUninstallSubkeys()
    {
        var result = new List<(RegBase, string)>();
        foreach (var b in UninstallBases)
        {
            using var k = SafeOpen(b.Hive, b.Path);
            if (k == null) continue;
            foreach (var sub in k.GetSubKeyNames())
            {
                using var sk = SafeOpen(k, sub);
                if (sk == null) continue;
                try
                {
                    string displayName = sk.GetValue("DisplayName") as string ?? "";
                    if (string.IsNullOrWhiteSpace(displayName)) { result.Add((b, sub)); continue; }
                    string uninstall = sk.GetValue("UninstallString") as string ?? "";
                    string quiet = sk.GetValue("QuietUninstallString") as string ?? "";
                    if (!string.IsNullOrWhiteSpace(uninstall) || !string.IsNullOrWhiteSpace(quiet)) continue;
                    string loc = sk.GetValue("InstallLocation") as string ?? "";
                    bool locMissing = string.IsNullOrWhiteSpace(loc) || !Directory.Exists(ExpandEnv(loc.Trim('"', ' ')));
                    if (locMissing) result.Add((b, sub));
                }
                catch (Exception ex) { Diag.Swallow("Backend/#15", ex); }
            }
        }
        return result;
    }

    static (ulong, int) CleanUninstall()
    {
        var orphans = OrphanUninstallSubkeys();
        if (orphans.Count == 0) return (0, 0);
        var backups = new List<object>();
        foreach (var (b, sub) in orphans)
        {
            object? tree = null;
            using (var parent = SafeOpen(b.Hive, b.Path))
            {
                using var sk = parent == null ? null : SafeOpen(parent, sub);
                if (sk != null) tree = ExportKeyTree(sk);
            }
            backups.Add(new { key = FullName(b, sub), subkey = sub, hive = b.Label, parent = b.Path, tree });
        }
        SaveBackup("reg_uninstall", backups);
        int n = 0;
        foreach (var g in orphans.GroupBy(o => (o.b.Label, o.b.Path)))
        {
            var baseItem = UninstallBases.First(x => x.Label == g.Key.Label && x.Path == g.Key.Path);
            using var parent = OpenWritable(baseItem.Hive, baseItem.Path)
                ?? throw new Exception("acesso negado ao registro (execute como administrador)");
            foreach (var o in g)
            {
                try { parent.DeleteSubKeyTree(o.sub, false); n++; } catch (Exception ex) { Diag.Swallow("Backend/#16", ex); }
            }
        }
        return S(n);
    }

    // ---- CLSID ----
    static List<string> OrphanClsidNames()
    {
        var result = new List<string>();
        using var clsid = SafeOpen(Registry.ClassesRoot, "CLSID");
        if (clsid == null) return result;
        foreach (var sub in clsid.GetSubKeyNames())
        {
            using var sk = SafeOpen(clsid, sub);
            if (sk == null) continue;
            try
            {
                string? server = null;
                using (var k32 = SafeOpen(sk, "InprocServer32"))
                    server = k32?.GetValue(null) as string;
                if (string.IsNullOrWhiteSpace(server))
                    using (var k64 = SafeOpen(sk, "LocalServer32"))
                        server = k64?.GetValue(null) as string;
                if (string.IsNullOrWhiteSpace(server)) continue;
                string v = ExpandEnv(ExtractExe(server));
                bool looksLikeFile = v.Contains('\\') || v.EndsWith(".dll", StringComparison.OrdinalIgnoreCase)
                    || v.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) || v.EndsWith(".ocx", StringComparison.OrdinalIgnoreCase);
                if (!looksLikeFile) continue;
                if (File.Exists(v)) continue;
                // Handlers registrados como extensão de shell aprovada podem estar em uso:
                // nunca tratar como órfão (evita quebrar Explorer/terceiros).
                if (IsApprovedShellExtension(sub)) continue;
                result.Add(sub);
            }
            catch (Exception ex) { Diag.Swallow("Backend/#17", ex); }
        }
        return result;
    }

    static (ulong, int) CleanClsid()
    {
        var names = OrphanClsidNames();
        if (names.Count == 0) return (0, 0);
        var backups = new List<object>();
        foreach (var s in names)
        {
            object? tree = null;
            using (var clsid = SafeOpen(Registry.ClassesRoot, "CLSID"))
            {
                using var sk = clsid == null ? null : SafeOpen(clsid, s);
                if (sk != null) tree = ExportKeyTree(sk);
            }
            backups.Add(new { key = $@"HKCR\CLSID\{s}", subkey = s, hive = "HKCR", parent = "CLSID", tree });
        }
        SaveBackup("reg_com", backups);
        int n = 0;
        using (var k = OpenWritable(Registry.ClassesRoot, "CLSID")
            ?? throw new Exception("acesso negado ao registro (execute como administrador)"))
        {
            foreach (var s in names)
            {
                try { k.DeleteSubKeyTree(s, false); n++; } catch (Exception ex) { Diag.Swallow("Backend/#18", ex); }
            }
        }
        return S(n);
    }

    // CLSIDs listados em "Shell Extensions\Approved" estão registrados e em uso
    // pelo Windows/terceiros, mesmo que o servidor não esteja no caminho esperado.
    static bool IsApprovedShellExtension(string clsid)
    {
        try
        {
            using var approved = SafeOpen(Registry.LocalMachine,
                @"SOFTWARE\Microsoft\Windows\CurrentVersion\Shell Extensions\Approved");
            return approved?.GetValue(clsid) != null;
        }
        catch { return false; }
    }

    // ---- Extensões ----
    // Uma extensão só é considerada órfã quando nenhum vínculo do usuário ou do
    // sistema a referencia: UserChoice (padrão do usuário) e SystemFileAssociations
    // sobrevivem mesmo sem o ProgID em HKCR.
    static bool HasLiveExtensionBinding(string extension)
    {
        try
        {
            using (var userChoice = SafeOpen(Registry.CurrentUser,
                @"Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\" + extension + @"\UserChoice"))
                if (userChoice?.GetValue("ProgId") != null) return true;

            using (var system = SafeOpen(Registry.ClassesRoot, @"SystemFileAssociations\" + extension))
                if (system != null) return true;

            // Extensões com OpenWithProgids/OpenWithList continuam selecionáveis no menu "Abrir com".
            using var sk = SafeOpen(Registry.ClassesRoot, extension);
            if (sk != null)
            {
                using var openWith = SafeOpen(sk, "OpenWithProgids");
                if (openWith != null && openWith.GetValueNames().Length > 0) return true;
                using var openWithList = SafeOpen(sk, "OpenWithList");
                if (openWithList != null && openWithList.GetValueNames().Length > 0) return true;
            }
        }
        catch (Exception ex) { Diag.Swallow("Backend/#21", ex); }
        return false;
    }

    static List<string> OrphanExtensionNames()
    {
        var result = new List<string>();
        try
        {
            var progids = new HashSet<string>(Registry.ClassesRoot.GetSubKeyNames(), StringComparer.OrdinalIgnoreCase);
            foreach (var e in Registry.ClassesRoot.GetSubKeyNames())
            {
                if (!e.StartsWith('.')) continue;
                using var sk = SafeOpen(Registry.ClassesRoot, e);
                if (sk == null) continue;
                string progid = sk.GetValue(null) as string ?? "";
                if (string.IsNullOrWhiteSpace(progid) || progids.Contains(progid)) continue;
                if (HasLiveExtensionBinding(e)) continue;
                result.Add(e);
            }
        }
        catch (Exception ex) { Diag.Swallow("Backend/#22", ex); }
        return result;
    }

    static (ulong, int) CleanExtensions()
    {
        var names = OrphanExtensionNames();
        if (names.Count == 0) return (0, 0);
        var backups = new List<object>();
        foreach (var s in names)
        {
            object? tree = null;
            using (var sk = SafeOpen(Registry.ClassesRoot, s))
                if (sk != null) tree = ExportKeyTree(sk);
            backups.Add(new { key = $@"HKCR\{s}", subkey = s, hive = "HKCR", parent = "", tree });
        }
        SaveBackup("reg_file_ext", backups);
        int n = 0;
        foreach (var s in names)
        {
            try { Registry.ClassesRoot.DeleteSubKeyTree(s, false); n++; } catch (Exception ex) { Diag.Swallow("Backend/#23", ex); }
        }
        return S(n);
    }

    // ---- RunMRU ----
    static List<string> RunMruOrphanNames()
    {
        var names = new List<string>();
        using var k = SafeOpen(Registry.CurrentUser, RunMruPath);
        if (k == null) return names;
        foreach (var name in k.GetValueNames())
            if (name != "MRUList") names.Add(name);
        return names;
    }

    static (ulong, int) CleanRunMru()
    {
        var names = RunMruOrphanNames();
        if (names.Count == 0) return (0, 0);
        using var k = OpenWritable(Registry.CurrentUser, RunMruPath)
            ?? throw new Exception("não foi possível abrir RunMRU");
        var backups = new List<object>();
        int n = 0;
        foreach (var name in names)
        {
            backups.Add(new { key = $@"HKCU\{RunMruPath}", name, data = k.GetValue(name), kind = SafeKind(k, name) });
            try { k.DeleteValue(name, false); n++; } catch (Exception ex) { Diag.Swallow("Backend/#22", ex); }
        }
        SaveBackup("reg_mru", backups);
        return S(n);
    }

    // ---- Fontes ----
    static List<string> FontOrphanNames()
    {
        var names = new List<string>();
        using var k = SafeOpen(Registry.LocalMachine, FontsPath);
        if (k == null) return names;
        string windirFonts = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "Fonts");
        foreach (var name in k.GetValueNames())
        {
            string data = k.GetValue(name) as string ?? "";
            if (string.IsNullOrWhiteSpace(data)) continue;
            string file = data.Contains('\\')
                ? ExpandEnv(data)
                : Path.Combine(windirFonts, Path.GetFileName(data));
            if (!File.Exists(file)) names.Add(name);
        }
        return names;
    }

    static (ulong, int) CleanFonts()
    {
        var names = FontOrphanNames();
        if (names.Count == 0) return (0, 0);
        using var k = OpenWritable(Registry.LocalMachine, FontsPath)
            ?? throw new Exception("acesso negado ao registro (execute como administrador)");
        var backups = new List<object>();
        int n = 0;
        foreach (var name in names)
        {
            backups.Add(new { key = $@"HKLM\{FontsPath}", name, data = k.GetValue(name), kind = SafeKind(k, name) });
            try { k.DeleteValue(name, false); n++; } catch (Exception ex) { Diag.Swallow("Backend/#23", ex); }
        }
        SaveBackup("reg_fonts", backups);
        return S(n);
    }

    // ---- App Paths ----
    static List<string> OrphanAppPathNames()
    {
        var names = new List<string>();
        using var k = SafeOpen(Registry.LocalMachine, AppPathsPath);
        if (k == null) return names;
        string windir = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
        foreach (var sub in k.GetSubKeyNames())
        {
            using var sk = SafeOpen(k, sub);
            if (sk == null) continue;
            string data = sk.GetValue(null) as string ?? "";
            if (string.IsNullOrWhiteSpace(data)) continue;
            string exe = ExpandEnv(ExtractExe(data));
            if (!Path.IsPathRooted(exe)) exe = Path.Combine(windir, exe);
            if (!File.Exists(exe)) names.Add(sub);
        }
        return names;
    }

    static (ulong, int) CleanAppPaths()
    {
        var names = OrphanAppPathNames();
        if (names.Count == 0) return (0, 0);
        var backups = new List<object>();
        foreach (var s in names)
        {
            object? tree = null;
            using (var parent = SafeOpen(Registry.LocalMachine, AppPathsPath))
            {
                using var sk = parent == null ? null : SafeOpen(parent, s);
                if (sk != null) tree = ExportKeyTree(sk);
            }
            backups.Add(new { key = $@"HKLM\{AppPathsPath}\{s}", subkey = s, hive = "HKLM", parent = AppPathsPath, tree });
        }
        SaveBackup("reg_help", backups);
        int n = 0;
        using (var k = OpenWritable(Registry.LocalMachine, AppPathsPath)
            ?? throw new Exception("acesso negado ao registro (execute como administrador)"))
        {
            foreach (var s in names)
            {
                try { k.DeleteSubKeyTree(s, false); n++; } catch (Exception ex) { Diag.Swallow("Backend/#24", ex); }
            }
        }
        return S(n);
    }

    // ============================ INICIALIZACAO ============================

    sealed record StartupEntry(string Name, string Path, bool Enabled, string Location);

    // migração: valores desabilitados viviam em HKCU\Software\CClinear antes do rename
    static bool _storeMigrated;

    static void EnsureStoreMigration()
    {
        if (_storeMigrated) return;
        _storeMigrated = true;
        try
        {
            using var neu = Registry.CurrentUser.OpenSubKey(StorePath);
            if (neu != null) return;
            using var old = Registry.CurrentUser.OpenSubKey(@"Software\CClinear\StartupDisabled");
            if (old == null) return;
            using var created = Registry.CurrentUser.CreateSubKey(StorePath);
            if (created == null) return;
            foreach (var name in old.GetValueNames())
            {
                try { created.SetValue(name, old.GetValue(name) as string ?? ""); } catch (Exception ex) { Diag.Swallow("Backend/#26", ex); }
            }
        }
        catch (Exception ex) { Diag.Swallow("EnsureStoreMigration", ex); }
    }

    static List<StartupEntry> CollectStartupItems()
    {
        EnsureStoreMigration();
        var entries = new List<StartupEntry>();
        using var store = SafeOpen(Registry.CurrentUser, StorePath);
        var storeNames = store == null
            ? new HashSet<string>()
            : new HashSet<string>(store.GetValueNames());

        foreach (var (label, hive, sub) in RunLocations)
        {
            using var k = SafeOpen(hive, sub);
            if (k == null) continue;
            foreach (var name in k.GetValueNames())
            {
                string data = k.GetValue(name) as string ?? "";
                bool enabled = !storeNames.Contains(label + "::" + name);
                entries.Add(new StartupEntry(name, data, enabled, label));
            }
        }

        if (store != null)
        {
            foreach (var sn in store.GetValueNames())
            {
                string data = store.GetValue(sn) as string ?? "";
                int idx = sn.IndexOf("::", StringComparison.Ordinal);
                string locName = idx > 0 ? sn[..idx] : sn;
                string name = idx > 0 ? sn[(idx + 2)..] : sn;
                entries.Add(new StartupEntry(name, data, false, locName));
            }
        }

        foreach (var (dir, locName) in new[]
        {
            (Environment.GetFolderPath(Environment.SpecialFolder.Startup), "Startup Folder"),
            (Environment.GetFolderPath(Environment.SpecialFolder.CommonStartup), "Common Startup"),
        })
        {
            if (string.IsNullOrEmpty(dir) || !Directory.Exists(dir)) continue;
            foreach (var f in Directory.GetFiles(dir))
                entries.Add(new StartupEntry(Path.GetFileNameWithoutExtension(f), f, true, locName));
        }

        return entries;
    }

    static int CountEnabledStartup() => CollectStartupItems().Count(e => e.Enabled);

    public static List<object> GetStartupItems() =>
        CollectStartupItems()
            .Select(e => (object)new { name = e.Name, path = e.Path, enabled = e.Enabled, location = e.Location })
            .ToList();

    static (RegistryKey hive, string sub)? ResolveLocation(string label)
    {
        foreach (var (l, hive, sub) in RunLocations)
            if (l == label) return (hive, sub);
        return null;
    }

    public static object ToggleStartupItem(string path, bool enable)
    {
        EnsureStoreMigration();
        if (enable)
        {
            using var store = OpenWritable(Registry.CurrentUser, StorePath)
                ?? throw new Exception("não foi possível abrir o armazenamento de inicialização");
            foreach (var sn in store.GetValueNames())
            {
                if (!string.Equals(store.GetValue(sn) as string, path, StringComparison.OrdinalIgnoreCase)) continue;
                int idx = sn.IndexOf("::", StringComparison.Ordinal);
                string locName = idx > 0 ? sn[..idx] : "";
                string name = idx > 0 ? sn[(idx + 2)..] : sn;
                var loc = ResolveLocation(locName)
                    ?? throw new Exception($"localização desconhecida: {locName}");
                using (var k = OpenWritable(loc.hive, loc.sub))
                {
                    if (k == null) throw new Exception("acesso negado ao registro (execute como administrador)");
                    k.SetValue(name, path);
                }
                store.DeleteValue(sn, false);
                return new { ok = true };
            }
            throw new Exception("item não encontrado no armazenamento de desabilitados");
        }
        else
        {
            foreach (var (label, hive, sub) in RunLocations)
            {
                using var k = SafeOpen(hive, sub);
                if (k == null) continue;
                foreach (var name in k.GetValueNames())
                {
                    string data = k.GetValue(name) as string ?? "";
                    if (!string.Equals(data, path, StringComparison.OrdinalIgnoreCase)) continue;
                    using (var store = OpenWritable(Registry.CurrentUser, StorePath))
                    {
                        if (store == null) throw new Exception("não foi possível abrir o armazenamento de inicialização");
                        store.SetValue(label + "::" + name, data);
                    }
                    using (var wk = OpenWritable(hive, sub))
                    {
                        if (wk == null) throw new Exception("acesso negado ao registro (execute como administrador)");
                        wk.DeleteValue(name, false);
                    }
                    return new { ok = true };
                }
            }
            throw new Exception("item de inicialização não encontrado");
        }
    }

    // ============================ PROGRAMAS ============================

    public static List<object> GetInstalledPrograms()
    {
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var list = new List<object>();
        foreach (var b in UninstallBases)
        {
            using var k = SafeOpen(b.Hive, b.Path);
            if (k == null) continue;
            foreach (var s in k.GetSubKeyNames())
            {
                using var sk = SafeOpen(k, s);
                if (sk == null) continue;
                try
                {
                    string name = sk.GetValue("DisplayName") as string ?? "";
                    if (string.IsNullOrWhiteSpace(name) || !seen.Add(name)) continue;
                    string version = sk.GetValue("DisplayVersion") as string ?? "";
                    string publisher = sk.GetValue("Publisher") as string ?? "";
                    string installDate = sk.GetValue("InstallDate") as string ?? "";
                    string size = "";
                    object? est = sk.GetValue("EstimatedSize");
                    if (est is int kb) size = $"{kb} KB";
                    string uninstall = sk.GetValue("UninstallString") as string ?? "";
                    list.Add(new { name, version, publisher, install_date = installDate, size, uninstall_string = uninstall });
                }
                catch (Exception ex) { Diag.Swallow("Backend/#27", ex); }
            }
        }
        return list;
    }

    public static object UninstallProgram(string name)
    {
        foreach (var b in UninstallBases)
        {
            using var k = SafeOpen(b.Hive, b.Path);
            if (k == null) continue;
            foreach (var s in k.GetSubKeyNames())
            {
                using var sk = SafeOpen(k, s);
                if (sk == null) continue;
                string dn = sk.GetValue("DisplayName") as string ?? "";
                if (!string.Equals(dn, name, StringComparison.OrdinalIgnoreCase)) continue;
                string us = sk.GetValue("UninstallString") as string ?? "";
                if (string.IsNullOrWhiteSpace(us)) throw new Exception("sem comando de desinstalação registrado");
                var psi = new ProcessStartInfo("cmd.exe", "/c " + us)
                {
                    CreateNoWindow = true,
                    UseShellExecute = false,
                };
                Process.Start(psi);
                return new { ok = true };
            }
        }
        throw new Exception("programa não encontrado");
    }

    // ============================ DISCO ============================

    public static void OpenUrl(string url)
    {
        try
        {
            if (Uri.TryCreate(url, UriKind.Absolute, out var uri) &&
                (uri.Scheme == Uri.UriSchemeHttps || uri.Scheme == Uri.UriSchemeHttp))
                Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
        }
        catch (Exception ex) { Diag.Swallow("OpenUrl " + url, ex); }
    }

    /// <summary>Reabre o CClouder com elevação (UAC). Retorna true se o UAC foi aceito.</summary>
    public static object RestartAsAdmin()
    {
        string exe = Environment.ProcessPath ?? "";
        if (!exe.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
            throw new Exception("disponível apenas no executável publicado");
        if (App.IsElevated()) return new { ok = true, already_admin = true };

        try
        {
            var psi = new ProcessStartInfo(exe)
            {
                UseShellExecute = true,
                Verb = "runas",
            };
            Process.Start(psi);
            Diag.Info("reabrindo com elevação");
            return new { ok = true, already_admin = false };
        }
        catch (System.ComponentModel.Win32Exception ex) when (ex.NativeErrorCode == 1223)
        {
            // 1223 = ERROR_CANCELLED: o usuário recusou o UAC.
            return new { ok = false, cancelled = true };
        }
        catch (Exception ex)
        {
            Diag.Error("RestartAsAdmin", ex);
            throw new Exception("não foi possível reabrir como administrador: " + ex.Message);
        }
    }

    public static void OpenPath(string p)
    {
        try
        {
            if (Directory.Exists(p))
                Process.Start(new ProcessStartInfo("explorer.exe", $"\"{p}\"") { UseShellExecute = true });
            else
                Process.Start(new ProcessStartInfo(p) { UseShellExecute = true });
        }
        catch (Exception ex) { Diag.Swallow("Backend/#28", ex); }
    }

    public static object AnalyzeDisk(string path)
    {
        if (!Directory.Exists(path)) throw new Exception("pasta não encontrada: " + path);
        var dirs = Directory.GetDirectories(path);
        var bag = new ConcurrentBag<(string name, string path, ulong size, int files)>();
        Parallel.ForEach(dirs, d =>
        {
            ulong size = 0; int files = 0;
            Walk(d, null, ref size, ref files);
            bag.Add((Path.GetFileName(d), d, size, files));
        });
        var folders = bag
            .Where(f => f.size > 0)
            .OrderByDescending(f => f.size)
            .Take(20)
            .Select(f => new { name = f.name, path = f.path, size = f.size, file_count = f.files })
            .ToList();
        ulong total = bag.Aggregate(0UL, (acc, f) => acc + f.size);
        return new { path, total_size = total, folders };
    }
}