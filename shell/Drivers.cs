using Microsoft.Win32;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO;
using System.Management;
using System.Text.Json;

namespace CClinear;

// ======================================================================
// Drivers (v1.1): scan via WMI, busca na web, backup via pnputil,
// ponto de restauração via Checkpoint-Computer, e verificação de
// capacidades do ambiente.
// ======================================================================
public static partial class Backend
{
    const string DriverBackupRoot = "DriverBackups";

    static bool IsElevated()
    {
        try { return Environment.IsPrivilegedProcess; }
        catch { return false; }
    }

    // ---------------- scan ----------------

    public static List<object> GetDrivers()
    {
        var list = new List<object>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        try
        {
            using var searcher = new ManagementObjectSearcher(
                "SELECT DeviceName, DriverVersion, DriverDate, Manufacturer, DeviceClass, InfName, IsSigned FROM Win32_PnPSignedDriver");
            foreach (ManagementObject mo in searcher.Get())
            {
                string name = mo["DeviceName"] as string ?? "";
                string version = mo["DriverVersion"] as string ?? "";
                if (string.IsNullOrWhiteSpace(name) || string.IsNullOrWhiteSpace(version)) continue;
                string mfr = mo["Manufacturer"] as string ?? "";
                string cls = mo["DeviceClass"] as string ?? "";
                string inf = mo["InfName"] as string ?? "";
                string date = "";
                if (mo["DriverDate"] is string raw && raw.Length >= 8)
                    date = $"{raw[4..6]}/{raw[6..8]}/{raw[..4]}";
                bool signed = (mo["IsSigned"] as bool?) ?? true;
                var key = name + "|" + version + "|" + inf;
                if (!seen.Add(key)) continue;
                list.Add(new { name, version, manufacturer = mfr, device_class = cls, inf_name = inf, driver_date = date, is_signed = signed });
            }
        }
        catch (Exception ex)
        {
            throw new Exception("falha ao consultar drivers via WMI: " + ex.Message);
        }
        return list;
    }

    // ---------------- busca na web ----------------

    public static object SearchDriverWeb(string name, string manufacturer, string version)
    {
        string q = string.Join(' ', new[] { manufacturer, name, version, "driver download" }
            .Where(s => !string.IsNullOrWhiteSpace(s)))
            .Replace("\"", "");
        string url = "https://www.google.com/search?q=" + Uri.EscapeDataString(q);
        Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
        return new { ok = true, url };
    }

    // ---------------- backup (pnputil) ----------------

    public static object BackupDrivers()
    {
        if (!IsElevated())
            throw new Exception("o backup de drivers exige execução como administrador");
        string dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            DriverBackupRoot, DateTime.Now.ToString("yyyy-MM-dd_HHmmss"));
        Directory.CreateDirectory(dir);
        var psi = new ProcessStartInfo("pnputil.exe", $"/export-driver \"{dir}\"")
        {
            CreateNoWindow = true,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        using var p = Process.Start(psi) ?? throw new Exception("não foi possível iniciar o pnputil");
        string output = p.StandardOutput.ReadToEnd();
        p.WaitForExit(300000);
        int exported = CountExportedDirs(dir);
        return new { ok = true, path = dir, count = exported, output };
    }

    static int CountExportedDirs(string root)
    {
        try { return Directory.GetDirectories(root).Length; }
        catch { return 0; }
    }

    // ---------------- ponto de restauração ----------------

    public static object CreateRestorePoint()
    {
        if (!IsElevated())
            throw new Exception("a criação de ponto de restauração exige execução como administrador");
        var psi = new ProcessStartInfo("powershell.exe",
            "-NoProfile -ExecutionPolicy Bypass -Command " +
            "\"Checkpoint-Computer -Description 'CClinear (antes de atualizar drivers)' -RestorePointType MODIFY_SETTINGS\"")
        {
            CreateNoWindow = true,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        using var p = Process.Start(psi) ?? throw new Exception("não foi possível iniciar o PowerShell");
        string err = p.StandardError.ReadToEnd();
        string outp = p.StandardOutput.ReadToEnd();
        p.WaitForExit(300000);
        if (p.ExitCode != 0)
            throw new Exception($"Checkpoint-Computer falhou (exit {p.ExitCode}): {err.Trim()} {outp.Trim()}".Trim());
        return new { ok = true, message = "ponto de restauração criado" };
    }

    // ---------------- verificação de capacidades ----------------

    public static object VerifyCapabilities()
    {
        bool admin = IsElevated();
        bool pnputil = ResolveOnPath("pnputil.exe");
        bool powershell = ResolveOnPath("powershell.exe");
        bool systemRestore = false;
        string restoreNote = "";
        if (powershell)
        {
            try
            {
                var psi = new ProcessStartInfo("powershell.exe",
                    "-NoProfile -Command \"(Get-CimInstance -ClassName Win32_ComputerSystem -ErrorAction Stop) -ne $null\"")
                {
                    CreateNoWindow = true,
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                };
                using var p = Process.Start(psi)!;
                string o = p.StandardOutput.ReadToEnd();
                p.WaitForExit(30000);
                systemRestore = o.Contains("True", StringComparison.OrdinalIgnoreCase);
            }
            catch { }
        }
        // Averiguação do System Restore: valor 'RPSessionInterval'/'DisableSR' nas políticas
        try
        {
            using var k = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows NT\CurrentVersion\SystemRestore");
            int? disableSr = k?.GetValue("DisableSR") as int?;
            bool disabledByPolicy = disableSr == 1;
            restoreNote = disabledByPolicy
                ? "System Restore desativado por política (DisableSR=1)"
                : !admin ? "disponível ao executar como administrador"
                : "disponível";
            if (!disabledByPolicy && admin) systemRestore = true;
        }
        catch { }

        return new
        {
            is_elevated = admin,
            pnputil_available = pnputil,
            powershell_available = powershell,
            restore_point = systemRestore,
            restore_note = restoreNote,
            backup_drivers = admin && pnputil,
        };
    }

    static bool ResolveOnPath(string exe)
    {
        try
        {
            var psi = new ProcessStartInfo(exe, "/?")
            {
                CreateNoWindow = true,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            using var p = Process.Start(psi);
            if (p == null) return false;
            p.WaitForExit(10000);
            return true;
        }
        catch { return false; }
    }
}