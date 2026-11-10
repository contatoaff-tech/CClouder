using System.Collections.Concurrent;
using System.IO;
using System.Text;

namespace CClouder;

/// <summary>
/// Log de diagnóstico do app: arquivo rotativo em %LOCALAPPDATA%\CClouder\logs,
/// grava também em Debug. Substitui os catch { } silenciosos por evidência.
/// </summary>
public static class Diag
{
    static readonly object Gate = new();
    static readonly BlockingCollection<string> Queue = new(new ConcurrentQueue<string>());
    static readonly string Dir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CClouder", "logs");
    const int MaxFiles = 7;
    const long MaxFileBytes = 512 * 1024;

    static bool _started;

    public static string LogDir => Dir;

    public static void Info(string message) => Write("INFO", message);
    public static void Warn(string message) => Write("WARN", message);
    public static void Error(string message) => Write("ERROR", message);
    public static void Error(string message, Exception ex) => Write("ERROR", $"{message}: {ex}");

    /// <summary>Registra uma exceção engolida por um catch vazio, com contexto.</summary>
    public static void Swallow(string context, Exception ex) => Write("SWALLOWED", $"{context}: {ex}");

    static void Write(string level, string message)
    {
        string line = $"{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff} [{level}] {message}";
        try { System.Diagnostics.Debug.WriteLine("[CClouder] " + line); } catch { }
        StartWriter();
        try { Queue.TryAdd(line, TimeSpan.FromMilliseconds(50)); } catch { }
    }

    static void StartWriter()
    {
        lock (Gate)
        {
            if (_started) return;
            _started = true;
            try { Directory.CreateDirectory(Dir); } catch { }
            var thread = new Thread(WriterLoop) { IsBackground = true, Name = "CClouder.Diag" };
            thread.Start();
        }
    }

    static void WriterLoop()
    {
        while (!Queue.IsCompleted)
        {
            string? line;
            try { line = Queue.Take(); }
            catch (InvalidOperationException) { return; }

            try
            {
                string file = CurrentFile();
                File.AppendAllText(file, line + Environment.NewLine, Encoding.UTF8);
            }
            catch { }
        }
    }

    static string CurrentFile()
    {
        string today = DateTime.Now.ToString("yyyy-MM-dd");
        string file = Path.Combine(Dir, $"cclouder-{today}.log");
        try
        {
            if (File.Exists(file) && new FileInfo(file).Length > MaxFileBytes)
                file = Path.Combine(Dir, $"cclouder-{today}-{DateTime.Now:HHmmss}.log");
            Rotate();
        }
        catch { }
        return file;
    }

    static void Rotate()
    {
        try
        {
            var files = Directory.EnumerateFiles(Dir, "cclouder-*.log")
                .Select(f => new FileInfo(f))
                .OrderByDescending(f => f.LastWriteTime)
                .Skip(MaxFiles)
                .ToList();
            foreach (var f in files)
            {
                try { f.Delete(); } catch { }
            }
        }
        catch { }
    }
}
