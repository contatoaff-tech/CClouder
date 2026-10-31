using System.IO;
using System.Threading;
using System.Windows;

namespace CClouder;

public partial class App : System.Windows.Application
{
    private Mutex? _mutex;

    protected override void OnStartup(StartupEventArgs e)
    {
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
            Shutdown(0);
            return;
        }

        base.OnStartup(e);
        var win = new MainWindow();
        MainWindow = win;
        win.Show();
    }

    private static void RunHeadlessClean()
    {
        try
        {
            string dir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "CClouder", "logs");
            Directory.CreateDirectory(dir);
            string file = Path.Combine(dir, $"clean-{DateTime.Now:yyyyMMdd-HHmmss}.log");
            var lines = new List<string> { $"CClouder — limpeza headless em {DateTime.Now:yyyy-MM-dd HH:mm:ss}" };
            var (items, bytes, errors) = Backend.CleanHeadless(l => lines.Add(l));
            lines.Add($"TOTAL: {items} itens removidos, {bytes / (1024.0 * 1024.0):0.0} MB liberados, {errors} erros");
            File.WriteAllLines(file, lines);
        }
        catch { }
    }
}