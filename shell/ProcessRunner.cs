using System.Diagnostics;
using System.Text;

namespace CClouder;

public static partial class Backend
{
    /// <summary>
    /// Executa um processo capturando stdout/stderr sem risco de deadlock
    /// (leitura assíncrona) e com timeout que mata o processo.
    /// </summary>
    internal static (string stdout, string stderr, int exitCode, bool timedOut) RunCapturedEx(
        string exe, string args, int timeoutMs, string? argumentsFormat = null)
    {
        var psi = new ProcessStartInfo(exe, args)
        {
            CreateNoWindow = true,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
        };
        using var p = Process.Start(psi) ?? throw new Exception($"não foi possível iniciar {exe}");

        var stdoutTask = p.StandardOutput.ReadToEndAsync();
        var stderrTask = p.StandardError.ReadToEndAsync();

        bool exited = p.WaitForExit(timeoutMs);
        if (!exited)
        {
            try { p.Kill(entireProcessTree: true); } catch (Exception ex) { Diag.Swallow($"RunCaptured kill {exe}", ex); }
            Diag.Warn($"RunCaptured timeout: {exe} {args} ({timeoutMs}ms)");
            return (stdoutTask.IsCompleted ? stdoutTask.Result : "", stderrTask.IsCompleted ? stderrTask.Result : "", -1, true);
        }

        string stdout, stderr;
        try
        {
            Task.WaitAll([stdoutTask, stderrTask], TimeSpan.FromSeconds(10));
            stdout = stdoutTask.IsCompleted ? stdoutTask.Result : "";
            stderr = stderrTask.IsCompleted ? stderrTask.Result : "";
        }
        catch (Exception ex)
        {
            Diag.Swallow($"RunCaptured drain {exe}", ex);
            stdout = ""; stderr = "";
        }
        return (stdout, stderr, p.ExitCode, false);
    }

    /// <summary>Compatível com o formato antigo: stdout ou exceção em timeout.</summary>
    internal static string RunCaptured(string exe, string args, int timeoutMs)
    {
        var (stdout, stderr, _, timedOut) = RunCapturedEx(exe, args, timeoutMs);
        if (timedOut) throw new Exception($"{exe} não respondeu em {timeoutMs / 1000}s");
        return stdout;
    }
}
