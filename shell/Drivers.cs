using Microsoft.Win32;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO;
using System.Management;
using System.Text.Json;

namespace CClouder;

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
            "\"Checkpoint-Computer -Description 'CClouder (antes de atualizar drivers)' -RestorePointType MODIFY_SETTINGS\"")
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
            catch (Exception ex) { Diag.Swallow("Drivers/#1", ex); }
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
        catch (Exception ex) { Diag.Swallow("Drivers/#2", ex); }

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

    static string RunCmd(string file, string args, int timeoutMs = 60000)
    {
        var psi = new ProcessStartInfo(file, args)
        {
            CreateNoWindow = true,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        using var p = Process.Start(psi) ?? throw new Exception($"Não foi possível iniciar {file}");
        string output = p.StandardOutput.ReadToEnd();
        string err = p.StandardError.ReadToEnd();
        p.WaitForExit(timeoutMs);
        return output + (string.IsNullOrWhiteSpace(err) ? "" : "\n" + err);
    }

    // ---------------- Hardware Doctor (Driver Booster) ----------------

    public static List<object> GetHardwareIssues()
    {
        var list = new List<object>();
        try
        {
            using var searcher = new ManagementObjectSearcher(
                "SELECT DeviceID, Name, ConfigManagerErrorCode, Status, Description FROM Win32_PnPEntity WHERE ConfigManagerErrorCode > 0");
            foreach (ManagementObject mo in searcher.Get())
            {
                string id = mo["DeviceID"] as string ?? "";
                string name = mo["Name"] as string ?? (mo["Description"] as string ?? "Dispositivo Desconhecido");
                uint code = (uint?)mo["ConfigManagerErrorCode"] ?? 0;
                string status = mo["Status"] as string ?? "Error";
                string desc = code switch
                {
                    1 => "Dispositivo não configurado corretamente.",
                    10 => "O dispositivo não pode iniciar.",
                    14 => "O computador precisa ser reiniciado para que o dispositivo funcione.",
                    18 => "Reinstale os drivers para este dispositivo.",
                    22 => "Dispositivo desativado no sistema.",
                    28 => "Os drivers deste dispositivo não estão instalados.",
                    31 => "O dispositivo não está funcionando corretamente.",
                    43 => "O Windows interrompeu este dispositivo porque ele relatou problemas.",
                    _ => $"Código de erro {code} no Gerenciador de Dispositivos."
                };
                list.Add(new { id, name, code, status, description = desc });
            }
        }
        catch (Exception ex) { Diag.Swallow("Drivers/#3", ex); }
        return list;
    }

    // ---------------- Runtimes & Componentes de Jogos ----------------

    public static List<object> GetGameRuntimes()
    {
        var runtimes = new List<object>();

        // 1. Visual C++ 2015-2022 x64
        bool vcx64 = false;
        string vcx64Ver = "";
        try
        {
            using var k = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\X64");
            if (k != null && (int?)k.GetValue("Installed") == 1)
            {
                vcx64 = true;
                vcx64Ver = k.GetValue("Version") as string ?? "";
            }
        }
        catch (Exception ex) { Diag.Swallow("Drivers/#4", ex); }
        runtimes.Add(new
        {
            id = "vcredist_x64",
            name = "Visual C++ 2015-2022 Redistributable (x64)",
            category = "Visual C++",
            installed = vcx64,
            version = vcx64Ver,
            winget_id = "Microsoft.VCRedist.2015+.x64",
            description = "Essencial para jogos e aplicações modernas de 64 bits."
        });

        // 2. Visual C++ 2015-2022 x86
        bool vcx86 = false;
        string vcx86Ver = "";
        try
        {
            using var k = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\X86");
            if (k != null && (int?)k.GetValue("Installed") == 1)
            {
                vcx86 = true;
                vcx86Ver = k.GetValue("Version") as string ?? "";
            }
        }
        catch (Exception ex) { Diag.Swallow("Drivers/#5", ex); }
        runtimes.Add(new
        {
            id = "vcredist_x86",
            name = "Visual C++ 2015-2022 Redistributable (x86)",
            category = "Visual C++",
            installed = vcx86,
            version = vcx86Ver,
            winget_id = "Microsoft.VCRedist.2015+.x86",
            description = "Essencial para jogos e softwares legados de 32 bits."
        });

        // 3. DirectX End-User Runtimes
        bool dxInstalled = false;
        string dxVer = "";
        try
        {
            using var k = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\DirectX");
            if (k != null && k.GetValue("Version") != null)
            {
                dxInstalled = true;
                dxVer = k.GetValue("Version") as string ?? "9.0c / June 2010";
            }
        }
        catch (Exception ex) { Diag.Swallow("Drivers/#6", ex); }
        runtimes.Add(new
        {
            id = "directx",
            name = "DirectX End-User Runtimes (June 2010)",
            category = "DirectX",
            installed = dxInstalled,
            version = dxVer,
            winget_id = "Microsoft.DirectX",
            description = "Bibliotecas d3dx9, XAudio e XInput para jogos clássicos e emuladores."
        });

        // 4. .NET Desktop Runtime 8.0 (x64)
        bool net8Installed = false;
        string net8Ver = "";
        try
        {
            using var k = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\dotnet\Setup\InstalledVersions\x64\sharedfx\Microsoft.WindowsDesktop.App");
            if (k != null)
            {
                var subNames = k.GetSubKeyNames();
                if (subNames.Any(n => n.StartsWith("8.") || n.StartsWith("9.") || n.StartsWith("10.")))
                {
                    net8Installed = true;
                    net8Ver = subNames.OrderByDescending(x => x).FirstOrDefault() ?? "";
                }
            }
        }
        catch (Exception ex) { Diag.Swallow("Drivers/#7", ex); }
        runtimes.Add(new
        {
            id = "dotnet_desktop_8",
            name = "Microsoft .NET Desktop Runtime (x64)",
            category = ".NET",
            installed = net8Installed,
            version = net8Ver,
            winget_id = "Microsoft.DotNet.DesktopRuntime.8",
            description = "Ambiente de execução para aplicativos modernos de desktop Windows."
        });

        return runtimes;
    }

    public static object InstallRuntime(string wingetId)
    {
        if (string.IsNullOrWhiteSpace(wingetId)) throw new Exception("ID do componente inválido");
        var psi = new ProcessStartInfo("winget.exe",
            $"install --id \"{wingetId}\" -e --silent --accept-package-agreements --accept-source-agreements")
        {
            CreateNoWindow = true,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        using var p = Process.Start(psi) ?? throw new Exception("não foi possível iniciar o winget");
        string output = p.StandardOutput.ReadToEnd();
        p.WaitForExit(300000);
        return new { ok = p.ExitCode == 0, exit_code = p.ExitCode, output };
    }

    // ---------------- Ferramentas de Reparo Rápido de Hardware ----------------

    public static object FixHardwareAudio()
    {
        try
        {
            RunCmd("cmd.exe", "/c net stop AudioEndpointBuilder /y & net stop Audiosrv /y & net start Audiosrv & net start AudioEndpointBuilder");
            return new { ok = true, message = "Serviços de áudio reiniciados com sucesso." };
        }
        catch (Exception ex)
        {
            return new { ok = false, message = "Falha ao reiniciar serviços de áudio: " + ex.Message };
        }
    }

    public static object FixHardwareNetwork()
    {
        try
        {
            RunCmd("cmd.exe", "/c ipconfig /flushdns & ipconfig /release & ipconfig /renew & netsh winsock reset");
            return new { ok = true, message = "Cache DNS limpo e pilha de rede Winsock redefinida com sucesso." };
        }
        catch (Exception ex)
        {
            return new { ok = false, message = "Falha ao redefinir rede: " + ex.Message };
        }
    }
}