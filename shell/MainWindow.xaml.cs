using System.Collections.Concurrent;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using System.Windows;
using System.Windows.Interop;

namespace CClinear;

public partial class MainWindow : Window
{
    // Maps event name -> transformed callback ids (see shim.transformCallback)
    private readonly ConcurrentDictionary<string, ConcurrentBag<long>> _eventHandlers = new();

    private const string Shim = """
window.__cbs = new Map();
window.__pend = {};
let __cbid = 0, __reqid = 0;
window.__TAURI_INTERNALS__ = {
  transformCallback(cb, once) {
    const id = ++__cbid;
    window.__cbs.set(id, (data) => {
      if (once) window.__TAURI_INTERNALS__.unregisterCallback(id);
      return cb && cb(data);
    });
    return id;
  },
  unregisterCallback(id) { window.__cbs.delete(id); },
  runCallback(id, data) {
    const cb = window.__cbs.get(id);
    if (cb) cb(data);
  },
  invoke(cmd, args, options) {
    args = args || {};
    if (cmd === 'plugin:event|listen') { return Promise.resolve(args.handler + 1000000); }
    if (cmd === 'plugin:event|unlisten') { window.__TAURI_INTERNALS__.unregisterCallback(args.eventId - 1000000); return Promise.resolve(null); }
    return new Promise((resolve, reject) => {
      const id = ++__reqid;
      window.__pend[id] = { resolve, reject };
      window.chrome.webview.postMessage({ __req: id, __cmd: cmd, __payload: args });
    });
  },
  convertFileSrc(p) { return 'file:///' + String(p).replace(/\\\\/g, '/'); },
  metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
  plugins: {}
};
window.chrome.webview.addEventListener('message', (e) => {
  const d = e.data;
  if (!d || d.__req === undefined) return;
  const p = window.__pend[d.__req];
  if (p) {
    delete window.__pend[d.__req];
    if (d.ok) p.resolve(d.data); else p.reject(d.error);
  }
});
""";

    public MainWindow()
    {
        InitializeComponent();
        SourceInitialized += (s, e) => EnableDarkTitleBar();
        Loaded += async (_, _) => await InitWebViewAsync();
    }

    private async Task InitWebViewAsync()
    {
        Web.CoreWebView2InitializationCompleted += (_, _) =>
        {
            Web.CoreWebView2.WebMessageReceived += OnWebMessage;
        };
        await Web.EnsureCoreWebView2Async();
        await Web.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(Shim);
        string dist = Path.Combine(AppContext.BaseDirectory, "dist");
        Web.CoreWebView2.SetVirtualHostNameToFolderMapping(
            "cclinear.app", dist, CoreWebView2HostResourceAccessKind.Allow);
        Web.CoreWebView2.Navigate("https://cclinear.app/index.html");
    }

    // ---------- IPC bridge ----------

    private async void OnWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        long req;
        string cmd;
        JsonElement payload;
        try
        {
            using var doc = JsonDocument.Parse(e.WebMessageAsJson);
            req = doc.RootElement.GetProperty("__req").GetInt64();
            cmd = doc.RootElement.GetProperty("__cmd").GetString() ?? "";
            payload = doc.RootElement.GetProperty("__payload").Clone();
        }
        catch
        {
            return;
        }

        try
        {
            switch (cmd)
            {
                case "plugin:event|listen":
                {
                    string ev = payload.GetProperty("event").GetString() ?? "";
                    long handler = payload.GetProperty("handler").GetInt64();
                    _eventHandlers.GetOrAdd(ev, _ => new ConcurrentBag<long>()).Add(handler);
                    Reply(req, null);
                    break;
                }
                case "plugin:event|unlisten":
                {
                    string ev = payload.GetProperty("event").GetString() ?? "";
                    long id = payload.GetProperty("eventId").GetInt64() - 1000000;
                    if (_eventHandlers.TryGetValue(ev, out var bag))
                    {
                        var kept = new ConcurrentBag<long>();
                        foreach (var x in bag) if (x != id) kept.Add(x);
                        _eventHandlers[ev] = kept;
                    }
                    Reply(req, null);
                    break;
                }
                case "get_categories":
                    Reply(req, Backend.BuildCategories());
                    break;

                case "start_scan":
                {
                    Reply(req, null); // result arrives via events
                    var selected = new List<string>();
                    if (payload.TryGetProperty("selected_categories", out var arr) && arr.ValueKind == JsonValueKind.Array)
                        foreach (var v in arr.EnumerateArray())
                            if (v.GetString() is string s) selected.Add(s);
                    var cts = new CancellationTokenSource();
                    var old = Interlocked.Exchange(ref Backend.ScanCts, cts);
                    old?.Cancel();
                    var token = cts.Token;
                    _ = Task.Run(async () =>
                    {
                        try { await Backend.RunScan(tok => Emit("scan-progress", tok), ev => Emit("scan-complete", ev), selected, token); }
                        catch (OperationCanceledException) { }
                        catch (Exception ex) { System.Diagnostics.Debug.WriteLine("scan error: " + ex.Message); }
                    }, CancellationToken.None);
                    break;
                }
                case "cancel_scan":
                    Backend.ScanCts?.Cancel();
                    Reply(req, null);
                    break;

                case "clean_selected":
                {
                    var items = payload.Clone();
                    var result = await Task.Run(() => Backend.CleanSelected(items));
                    Reply(req, result);
                    break;
                }
                case "open_folder":
                {
                    string p = payload.GetProperty("path").GetString() ?? "";
                    Reply(req, null);
                    _ = Task.Run(() => Backend.OpenPath(p));
                    break;
                }
                case "get_startup_items":
                    Reply(req, Backend.GetStartupItems());
                    break;

                case "toggle_startup_item":
                {
                    string p = payload.GetProperty("path").GetString() ?? "";
                    bool enable = payload.GetProperty("enable").GetBoolean();
                    Reply(req, Backend.ToggleStartupItem(p, enable));
                    break;
                }
                case "get_installed_programs":
                    Reply(req, Backend.GetInstalledPrograms());
                    break;

                case "uninstall_program":
                {
                    string name = payload.GetProperty("name").GetString() ?? "";
                    Reply(req, Backend.UninstallProgram(name));
                    break;
                }
                case "analyze_disk":
                {
                    string p = payload.GetProperty("path").GetString() ?? "";
                    var result = await Task.Run(() => Backend.AnalyzeDisk(p));
                    Reply(req, result);
                    break;
                }
                case "get_drivers":
                {
                    var result = await Task.Run(() => Backend.GetDrivers());
                    Reply(req, result);
                    break;
                }
                case "search_driver_web":
                {
                    string name = payload.GetProperty("name").GetString() ?? "";
                    string mfr = payload.TryGetProperty("manufacturer", out var m) ? m.GetString() ?? "" : "";
                    string ver = payload.TryGetProperty("version", out var v) ? v.GetString() ?? "" : "";
                    Reply(req, Backend.SearchDriverWeb(name, mfr, ver));
                    break;
                }
                case "backup_drivers":
                {
                    var result = await Task.Run(() => Backend.BackupDrivers());
                    Reply(req, result);
                    break;
                }
                case "create_restore_point":
                {
                    var result = await Task.Run(() => Backend.CreateRestorePoint());
                    Reply(req, result);
                    break;
                }
                case "verify_capabilities":
                    Reply(req, Backend.VerifyCapabilities());
                    break;
                case "find_duplicates":
                {
                    string path = payload.GetProperty("path").GetString() ?? Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
                    long min = payload.TryGetProperty("min_size", out var ms) ? ms.GetInt64() : 1048576;
                    var result = await Task.Run(() => Backend.FindDuplicates(path, min));
                    Reply(req, result);
                    break;
                }
                case "delete_files":
                {
                    var paths = payload.GetProperty("paths").EnumerateArray().Select(x => x.GetString() ?? "").Where(s => s.Length > 0).ToArray();
                    var result = await Task.Run(() => Backend.DeleteFiles(paths));
                    Reply(req, result);
                    break;
                }
                case "shred_paths":
                {
                    var paths = payload.GetProperty("paths").EnumerateArray().Select(x => x.GetString() ?? "").Where(s => s.Length > 0).ToArray();
                    var result = await Task.Run(() => Backend.ShredPaths(paths));
                    Reply(req, result);
                    break;
                }
                case "get_context_menu":
                    Reply(req, Backend.GetContextMenuHandlers());
                    break;
                case "toggle_context_menu":
                {
                    string loc = payload.GetProperty("location").GetString() ?? "";
                    string key = payload.GetProperty("key").GetString() ?? "";
                    bool enable = payload.GetProperty("enable").GetBoolean();
                    Reply(req, Backend.ToggleContextMenuHandler(loc, key, enable));
                    break;
                }
                case "get_scheduled_tasks":
                {
                    var result = await Task.Run(() => Backend.GetScheduledTasksStartup());
                    Reply(req, result);
                    break;
                }
                case "toggle_scheduled_task":
                {
                    string tpath = payload.GetProperty("tpath").GetString() ?? "";
                    string name = payload.GetProperty("name").GetString() ?? "";
                    bool enable = payload.GetProperty("enable").GetBoolean();
                    var result = await Task.Run(() => Backend.ToggleScheduledTask(tpath, name, enable));
                    Reply(req, result);
                    break;
                }
                case "get_exclusions":
                    Reply(req, Backend.GetExclusions());
                    break;
                case "add_exclusion":
                {
                    string p = payload.GetProperty("path").GetString() ?? "";
                    Reply(req, Backend.AddExclusion(p));
                    break;
                }
                case "remove_exclusion":
                {
                    string p = payload.GetProperty("path").GetString() ?? "";
                    Reply(req, Backend.RemoveExclusion(p));
                    break;
                }
                case "run_health_check":
                {
                    var result = await Task.Run(() => Backend.RunHealthCheck(tok => Emit("scan-progress", tok)));
                    Reply(req, result);
                    break;
                }
                default:
                    ReplyError(req, $"comando desconhecido: {cmd}");
                    break;
            }
        }
        catch (Exception ex)
        {
            ReplyError(req, ex.Message);
        }
    }

    private void Reply(long req, object? data)
    {
        string json = JsonSerializer.Serialize(new { __req = req, ok = true, data });
        Post(json);
    }

    private void ReplyError(long req, string error)
    {
        string json = JsonSerializer.Serialize(new { __req = req, ok = false, error });
        Post(json);
    }

    private void Post(string json)
    {
        Dispatcher.InvokeAsync(() =>
        {
            try { Web.CoreWebView2.PostWebMessageAsJson(json); } catch { }
        });
    }

    private void Emit(string eventName, object data)
    {
        if (!_eventHandlers.TryGetValue(eventName, out var handlers)) return;
        string payloadJson = JsonSerializer.Serialize(new { @event = eventName, payload = data });
        foreach (long id in handlers)
        {
            string script = $"window.__TAURI_INTERNALS__.runCallback({id}, {payloadJson})";
            Dispatcher.InvokeAsync(async () =>
            {
                try { await Web.CoreWebView2.ExecuteScriptAsync(script); } catch { }
            });
        }
    }

    // ---------- dark title bar ----------

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

    private void EnableDarkTitleBar()
    {
        try
        {
            var hwnd = new WindowInteropHelper(this).Handle;
            int on = 1;
            DwmSetWindowAttribute(hwnd, 20, ref on, sizeof(int)); // DWMWA_USE_IMMERSIVE_DARK_MODE
        }
        catch { }
    }
}