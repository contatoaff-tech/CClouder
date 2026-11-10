using System.IO;
using System.Threading;
using System.Windows;

namespace CClouder;

public partial class App : System.Windows.Application
{
    private Mutex? _mutex;

    protected override void OnStartup(StartupEventArgs e)
    {
        Diag.Info($"início {Environment.ProcessPath ?? "?"} args=[{string.Join(' ', e.Args)}] user={Environment.UserName} elevated={IsElevated()}");

        AppDomain.CurrentDomain.UnhandledException += (_, ev) =>
            Diag.Error("UnhandledException", ev.ExceptionObject as Exception ?? new Exception(ev.ExceptionObject?.ToString()));

        DispatcherUnhandledException += (_, ev) =>
        {
            Diag.Error("DispatcherUnhandledException", ev.Exception);
            ev.Handled = false;
        };

        bool clean = e.Args.Any(a => a.Equals("--clean", StringComparison.OrdinalIgnoreCase));
        if (clean)
        {
            RunHeadlessClean();
            Shutdown(0);
            return;
        }

        _mutex = new Mutex(true, "CClouder.SingleInstance.v1", out bool created);
        if (!created)
        {
            Diag.Warn("segunda instância detectada; saindo");
            Shutdown(0);
            return;
        }

        base.OnStartup(e);
        var win = new MainWindow();
        MainWindow = win;
        win.Show();
    }

    internal static bool IsElevated()
    {
        try
        {
            var identity = System.Security.Principal.WindowsIdentity.GetCurrent();
            var principal = new System.Security.Principal.WindowsPrincipal(identity);
            return principal.IsInRole(System.Security.Principal.WindowsBuiltInRole.Administrator);
        }
        catch (Exception ex)
        {
            Diag.Swallow("IsElevated", ex);
            return false;
        }
    }

    private static void RunHeadlessClean()
    {
        try
        {
            string dir = Diag.LogDir;
            Directory.CreateDirectory(dir);
            string file = Path.Combine(dir, $"clean-{DateTime.Now:yyyyMMdd-HHmmss}.log");
            var lines = new List<string> { $"CClouder — limpeza headless em {DateTime.Now:yyyy-MM-dd HH:mm:ss}" };
            var (items, bytes, errors) = Backend.CleanHeadless(l => lines.Add(l));
            lines.Add($"TOTAL: {items} itens removidos, {bytes / (1024.0 * 1024.0):0.0} MB liberados, {errors} erros");
            File.WriteAllLines(file, lines);
            Diag.Info($"limpeza headless: {items} itens, {errors} erros, log={file}");
        }
        catch (Exception ex)
        {
            Diag.Error("RunHeadlessClean", ex);
        }
    }
}
