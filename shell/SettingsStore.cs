using Microsoft.Win32;
using System.Diagnostics;
using System.IO;
using System.Text.Json;

namespace CClouder;

// ======================================================================
// Settings (v1.5): persistência real, início com Windows, limpeza
// agendada (Task Scheduler) e limpeza headless (--clean --quiet).
// ======================================================================
public static partial class Backend
{
    static string SettingsFile =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "CClouder", "settings.json");

    static readonly object _settingsLock = new();

    public static object GetSettings()
    {
        var result = new Dictionary<string, object>
        {
            ["skip_system_files"] = true,
            ["confirm_delete"] = true,
            ["restore_point_before_clean"] = false,
            ["auto_scan"] = false,
            ["theme"] = "dark",
            ["language"] = "pt-BR",
            ["minimize_to_tray"] = false,
            ["start_minimized"] = false,
            ["start_with_windows"] = IsStartWithWindows(),
            ["schedule_enabled"] = ScheduleExists(),
            ["schedule_frequency"] = "daily",
            ["schedule_time"] = "10:00",
        };
        lock (_settingsLock)
        {
            try
            {
                if (File.Exists(SettingsFile))
                {
                    using var doc = JsonDocument.Parse(File.ReadAllText(SettingsFile));
                    foreach (var p in doc.RootElement.EnumerateObject())
                        result[p.Name] = p.Value.Clone();
                }
            }
            catch (Exception ex) { Diag.Swallow("SettingsStore/#4", ex); }
        }
        result["start_with_windows"] = IsStartWithWindows();
        result["schedule_enabled"] = ScheduleExists();
        return result;
    }

    public static object SaveSettings(JsonElement payload)
    {
        lock (_settingsLock)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(SettingsFile)!);
            File.WriteAllText(SettingsFile, payload.GetRawText());
        }
        return new { ok = true };
    }

    public static object SaveSetting(string key, JsonElement value)
    {
        lock (_settingsLock)
        {
            var dict = new Dictionary<string, JsonElement>();
            try
            {
                if (File.Exists(SettingsFile))
                    dict = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(File.ReadAllText(SettingsFile))
                           ?? new Dictionary<string, JsonElement>();
            }
            catch (Exception ex) { Diag.Swallow("SettingsStore/#5", ex); }
            dict[key] = value.Clone();
            Directory.CreateDirectory(Path.GetDirectoryName(SettingsFile)!);
            File.WriteAllText(SettingsFile, JsonSerializer.Serialize(dict));
        }
        return new { ok = true };
    }

    public static string GetSettingString(string key, string fallback)
    {
        try
        {
            if (!File.Exists(SettingsFile)) return fallback;
            using var doc = JsonDocument.Parse(File.ReadAllText(SettingsFile));
            if (doc.RootElement.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.String)
                return v.GetString() ?? fallback;
        }
        catch (Exception ex) { Diag.Swallow("SettingsStore/#6", ex); }
        return fallback;
    }

    public static bool GetSettingBool(string key, bool fallback)
    {
        try
        {
            if (!File.Exists(SettingsFile)) return fallback;
            using var doc = JsonDocument.Parse(File.ReadAllText(SettingsFile));
            if (doc.RootElement.TryGetProperty(key, out var v) &&
                (v.ValueKind == JsonValueKind.True || v.ValueKind == JsonValueKind.False))
                return v.GetBoolean();
        }
        catch (Exception ex) { Diag.Swallow("SettingsStore/#7", ex); }
        return fallback;
    }

    // ============================ INÍCIO COM WINDOWS ============================

    const string RunKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
    const string RunValueName = "CClouder";

    static bool IsStartWithWindows()
    {
        try
        {
            using var k = Registry.CurrentUser.OpenSubKey(RunKeyPath);
            return k?.GetValue(RunValueName) != null;
        }
        catch { return false; }
    }

    public static object SetStartWithWindows(bool enable)
    {
        string exe = Environment.ProcessPath ?? "";
        if (!exe.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
            throw new Exception("disponível apenas no executável publicado");
        try
        {
            using var k = Registry.CurrentUser.OpenSubKey(RunKeyPath, writable: true)
                ?? Registry.CurrentUser.CreateSubKey(RunKeyPath);
            if (k == null) throw new Exception("não foi possível abrir a chave Run");
            if (enable) k.SetValue(RunValueName, $"\"{exe}\"");
            else k.DeleteValue(RunValueName, throwOnMissingValue: false);
            return new { ok = true, enabled = enable };
        }
        catch (Exception ex)
        {
            throw new Exception("falha ao configurar início com Windows: " + ex.Message);
        }
    }

    // ============================ AGENDAMENTO (schtasks) ============================

    const string TaskName = "CClouder Cleanup";

    static bool ScheduleExists()
    {
        try
        {
            var o = RunCaptured("schtasks", $"/query /tn \"{TaskName}\"", 20000);
            return o.Contains(TaskName, StringComparison.OrdinalIgnoreCase);
        }
        catch { return false; }
    }

    public static object GetSchedule()
    {
        string next = "";
        bool exists = false;
        try
        {
            string o = RunCaptured("schtasks", $"/query /tn \"{TaskName}\" /fo LIST", 20000);
            exists = o.Contains(TaskName, StringComparison.OrdinalIgnoreCase);
            foreach (var line in o.Split('\n'))
            {
                string l = line.Trim();
                if (l.StartsWith("Next Run Time", StringComparison.OrdinalIgnoreCase) ||
                    l.StartsWith("Próxima Execução", StringComparison.OrdinalIgnoreCase) ||
                    l.StartsWith("Próxima execução", StringComparison.OrdinalIgnoreCase))
                {
                    int idx = l.IndexOf(':');
                    if (idx > 0) next = l[(idx + 1)..].Trim();
                }
            }
        }
        catch (Exception ex) { Diag.Swallow("SettingsStore/#8", ex); }
        return new { exists, next_run = next, task_name = TaskName };
    }

    public static object SetSchedule(bool enable, string frequency, string time)
    {
        if (!enable)
        {
            try { RunCaptured("schtasks", $"/delete /tn \"{TaskName}\" /f", 30000); } catch (Exception ex) { Diag.Swallow("SettingsStore/#9", ex); }
            return new { ok = true, enabled = false };
        }

        string exe = Environment.ProcessPath ?? "";
        if (!exe.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
            throw new Exception("agendamento disponível apenas no executável publicado");

        string freq = frequency.Equals("weekly", StringComparison.OrdinalIgnoreCase) ? "WEEKLY" : "DAILY";
        string st = string.IsNullOrWhiteSpace(time) ? "10:00" : time.Trim();
        if (!System.Text.RegularExpressions.Regex.IsMatch(st, @"^\d{1,2}:\d{2}$"))
            throw new Exception("horário inválido (use HH:mm)");

        string args = $"/create /tn \"{TaskName}\" /tr \"\\\"{exe}\\\" --clean --quiet\" /sc {freq} /st {st} /f";
        string output;
        try { output = RunCaptured("schtasks", args, 60000); }
        catch (Exception ex) { throw new Exception("falha ao criar tarefa: " + ex.Message); }

        if (!ScheduleExists())
            throw new Exception("a tarefa não foi criada: " + output.Trim());
        return new { ok = true, enabled = true, output = output.Trim() };
    }

    // ============================ LIMPEZA HEADLESS ============================

    public static (int items, ulong bytes, int errors) CleanHeadless(Action<string> log)
    {
        lock (_exclLock) EnsureExclusions();
        var cats = BuildCategories()
            .Where(c => c.id is "system" or "browser" or "apps")
            .ToList();
        int items = 0, errors = 0;
        ulong bytes = 0;
        foreach (var cat in cats)
        {
            foreach (var it in cat.items.Where(i => i.@checked))
            {
                try
                {
                    var (b, n) = CleanItem(it);
                    bytes += b;
                    items += n;
                    log($"{it.name}: {n} itens, {b} bytes");
                }
                catch (Exception ex)
                {
                    errors++;
                    log($"{it.name}: ERRO {ex.Message}");
                }
            }
        }
        return (items, bytes, errors);
    }
}