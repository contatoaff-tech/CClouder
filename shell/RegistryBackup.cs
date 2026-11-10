using Microsoft.Win32;
using System.IO;
using System.Text.Json;

namespace CClouder;

// ======================================================================
// Registry Backup restore (v1.3): exportação de árvore completa e
// restauração de backups JSON gerados pelas limpezas de registro.
// ======================================================================
public static partial class Backend
{
    // ---------- exportação ----------

    static object? ExportKeyTree(RegistryKey key)
    {
        try
        {
            var values = new List<object>();
            foreach (var name in key.GetValueNames())
            {
                string kind;
                object? raw;
                try
                {
                    kind = key.GetValueKind(name).ToString();
                    raw = key.GetValue(name);
                }
                catch { continue; }
                object? ser = raw switch
                {
                    null => null,
                    byte[] b => Convert.ToBase64String(b),
                    string[] arr => arr,
                    string s => s,
                    int i => i,
                    long l => l,
                    _ => raw.ToString(),
                };
                values.Add(new { name, kind, data = ser });
            }

            var subkeys = new List<object>();
            foreach (var sub in key.GetSubKeyNames())
            {
                using var sk = SafeOpen(key, sub);
                if (sk == null) continue;
                subkeys.Add(new { name = sub, tree = ExportKeyTree(sk) });
            }
            return new { values, subkeys };
        }
        catch { return null; }
    }

    // chave de registro formatada: "HKLM\SOFTWARE\..." -> (hive, subpath)
    static (RegistryKey hive, string path) SplitHive(string fullKey)
    {
        string k = fullKey.TrimStart('\\');
        if (k.StartsWith("HKCU\\", StringComparison.OrdinalIgnoreCase))
            return (Registry.CurrentUser, k[5..]);
        if (k.StartsWith("HKLM\\", StringComparison.OrdinalIgnoreCase))
            return (Registry.LocalMachine, k[5..]);
        if (k.StartsWith("HKCR\\", StringComparison.OrdinalIgnoreCase))
            return (Registry.ClassesRoot, k[5..]);
        if (k.StartsWith("HKU\\", StringComparison.OrdinalIgnoreCase))
            return (Registry.Users, k[4..]);
        return (Registry.LocalMachine, k);
    }

    static RegistryKey? OpenWritableCreate(RegistryKey hive, string path)
    {
        try
        {
            using var existing = hive.OpenSubKey(path);
            if (existing != null) return hive.OpenSubKey(path, writable: true);
        }
        catch (Exception ex) { Diag.Swallow("RegistryBackup/#1", ex); }
        try { return hive.CreateSubKey(path, writable: true); }
        catch { return null; }
    }

    // ---------- listagem ----------

    public static List<object> ListRegistryBackups()
    {
        var dirs = new List<string>
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), BackupDirName),
            // pasta do nome antigo (CClinear) — mantida para restaurar backups históricos
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "CClinearBackups"),
        };
        var files = new List<string>();
        foreach (var dir in dirs.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            if (!Directory.Exists(dir)) continue;
            try { files.AddRange(Directory.GetFiles(dir, "backup-*.json")); } catch (Exception ex) { Diag.Swallow("RegistryBackup/#2", ex); }
        }
        return files
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderByDescending(f => f)
            .Take(100)
            .Select(f =>
            {
                var fi = new FileInfo(f);
                int entries = 0;
                bool restorable = true;
                try
                {
                    using var doc = JsonDocument.Parse(File.ReadAllText(f));
                    if (doc.RootElement.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var el in doc.RootElement.EnumerateArray())
                        {
                            entries++;
                            bool hasValue = el.TryGetProperty("name", out _) && el.TryGetProperty("data", out _);
                            bool hasTree = el.TryGetProperty("tree", out _);
                            if (!hasValue && !hasTree) restorable = false;
                        }
                    }
                }
                catch { restorable = false; }
                return (object)new
                {
                    file = f,
                    name = fi.Name,
                    date = fi.LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss"),
                    size = fi.Length,
                    entries,
                    restorable,
                };
            })
            .ToList();
    }

    // ---------- restauração ----------

    public static object RestoreRegistryBackup(string file)
    {
        if (!File.Exists(file)) throw new Exception("arquivo de backup não encontrado");
        using var doc = JsonDocument.Parse(File.ReadAllText(file));
        if (doc.RootElement.ValueKind != JsonValueKind.Array)
            throw new Exception("formato de backup não reconhecido");

        int values = 0, keys = 0, skipped = 0;
        var errors = new List<string>();

        foreach (var el in doc.RootElement.EnumerateArray())
        {
            // 1) entrada de VALOR: { key, name, data, kind }
            if (el.TryGetProperty("name", out var nameEl) &&
                el.TryGetProperty("data", out var dataEl) &&
                el.TryGetProperty("key", out var keyEl))
            {
                try
                {
                    string fullKey = keyEl.GetString() ?? "";
                    string name = nameEl.GetString() ?? "";
                    string kind = el.TryGetProperty("kind", out var kd) ? kd.GetString() ?? "String" : "String";
                    var (hive, path) = SplitHive(fullKey);
                    using var k = OpenWritableCreate(hive, path);
                    if (k == null) { skipped++; continue; }
                    object? value = ConvertBack(dataEl, kind);
                    if (value == null && kind != "Binary") { skipped++; continue; }
                    k.SetValue(name, value!, ParseKind(kind));
                    values++;
                }
                catch (Exception ex) { skipped++; errors.Add(ex.Message); }
                continue;
            }

            // 2) entrada de SUBCHAVE: { key, subkey, hive, parent, tree }
            if (el.TryGetProperty("subkey", out var subEl))
            {
                if (!el.TryGetProperty("tree", out var treeEl)) { skipped++; continue; }
                try
                {
                    string sub = subEl.GetString() ?? "";
                    string hiveLabel = el.TryGetProperty("hive", out var hl) ? hl.GetString() ?? "HKLM" : "HKLM";
                    string parentPath = el.TryGetProperty("parent", out var pp) ? pp.GetString() ?? "" : "";
                    var hive = hiveLabel.ToUpperInvariant() switch
                    {
                        "HKCU" => Registry.CurrentUser,
                        "HKCR" => Registry.ClassesRoot,
                        "HKU" => Registry.Users,
                        _ => Registry.LocalMachine,
                    };
                    bool root = string.IsNullOrEmpty(parentPath);
                    RegistryKey? parent = root ? hive : OpenWritableCreate(hive, parentPath);
                    if (parent == null) { skipped++; continue; }
                    try
                    {
                        using var target = parent.CreateSubKey(sub, writable: true);
                        if (target == null) { skipped++; continue; }
                        RestoreTree(target, treeEl);
                        keys++;
                    }
                    finally
                    {
                        if (!root) parent.Dispose();
                    }
                }
                catch (Exception ex) { skipped++; errors.Add(ex.Message); }
            }
        }

        return new { ok = true, restored_values = values, restored_keys = keys, skipped, errors = errors.Take(5).ToList() };
    }

    static void RestoreTree(RegistryKey key, JsonElement tree)
    {
        if (tree.TryGetProperty("values", out var vals) && vals.ValueKind == JsonValueKind.Array)
        {
            foreach (var v in vals.EnumerateArray())
            {
                try
                {
                    string name = v.TryGetProperty("name", out var n) ? n.GetString() ?? "" : "";
                    string kind = v.TryGetProperty("kind", out var k) ? k.GetString() ?? "String" : "String";
                    object? data = v.TryGetProperty("data", out var d) ? ConvertBack(d, kind) : null;
                    if (data == null && kind != "Binary") continue;
                    key.SetValue(name, data!, ParseKind(kind));
                }
                catch (Exception ex) { Diag.Swallow("RegistryBackup/#4", ex); }
            }
        }
    }

    static object? ConvertBack(JsonElement data, string kind)
    {
        try
        {
            switch (kind)
            {
                case "Binary":
                    return data.ValueKind == JsonValueKind.String
                        ? Convert.FromBase64String(data.GetString() ?? "")
                        : Array.Empty<byte>();
                case "DWord":
                    return data.ValueKind == JsonValueKind.Number ? data.GetInt32() : 0;
                case "QWord":
                    return data.ValueKind == JsonValueKind.Number ? data.GetInt64() : 0L;
                case "MultiString":
                    if (data.ValueKind == JsonValueKind.Array)
                        return data.EnumerateArray().Select(x => x.GetString() ?? "").ToArray();
                    return new[] { data.GetString() ?? "" };
                case "None":
                    return data.ValueKind == JsonValueKind.String ? data.GetString() : "";
                default:
                    return data.ValueKind switch
                    {
                        JsonValueKind.String => data.GetString(),
                        JsonValueKind.Number => data.ToString(),
                        _ => data.ToString(),
                    };
            }
        }
        catch { return null; }
    }

    static RegistryValueKind ParseKind(string kind) => kind switch
    {
        "Binary" => RegistryValueKind.Binary,
        "DWord" => RegistryValueKind.DWord,
        "QWord" => RegistryValueKind.QWord,
        "MultiString" => RegistryValueKind.MultiString,
        "ExpandString" => RegistryValueKind.ExpandString,
        "None" => RegistryValueKind.None,
        _ => RegistryValueKind.String,
    };
}