using System.IO;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace CClouder;

// ======================================================================
// File tools (v1.5): Czkawka-style — pastas vazias, arquivos vazios,
// maiores arquivos, imagens similares (dHash) e caches de desenvolvedor.
// ======================================================================
public static partial class Backend
{
    // ============================ PASTAS VAZIAS ============================

    public static object ScanEmptyFolders(string root)
    {
        if (!Directory.Exists(root)) throw new Exception("pasta não encontrada: " + root);
        lock (_exclLock) EnsureExclusions();
        var empty = new List<string>();
        var stack = new Stack<string>();
        stack.Push(root);
        while (stack.Count > 0)
        {
            var dir = stack.Pop();
            if (IsExcluded(dir)) continue;
            string[] subdirs, files;
            try { subdirs = Directory.GetDirectories(dir); files = Directory.GetFiles(dir); }
            catch { continue; }
            foreach (var d in subdirs) stack.Push(d);
            if (subdirs.Length == 0 && files.Length == 0 &&
                !string.Equals(dir.TrimEnd('\\'), root.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase))
                empty.Add(dir);
        }
        return new { root, count = empty.Count, folders = empty.Take(5000).ToList() };
    }

    // ============================ ARQUIVOS VAZIOS ============================

    public static object ScanEmptyFiles(string root)
    {
        if (!Directory.Exists(root)) throw new Exception("pasta não encontrada: " + root);
        lock (_exclLock) EnsureExclusions();
        var files = new List<string>();
        foreach (var f in EnumerateAllFiles(root))
        {
            try { if (new FileInfo(f).Length == 0) files.Add(f); } catch (Exception ex) { Diag.Swallow("FileTools/#2", ex); }
        }
        return new { root, count = files.Count, files = files.Take(5000).ToList() };
    }

    // ============================ MAIORES ARQUIVOS ============================

    public static object ScanBigFiles(string root, long minSize = 10485760, int limit = 100)
    {
        if (!Directory.Exists(root)) throw new Exception("pasta não encontrada: " + root);
        lock (_exclLock) EnsureExclusions();
        var collected = new List<(string path, long size, DateTime modified)>();
        foreach (var f in EnumerateAllFiles(root))
        {
            try
            {
                var fi = new FileInfo(f);
                if (fi.Length < minSize) continue;
                collected.Add((f, fi.Length, fi.LastWriteTime));
            }
            catch (Exception ex) { Diag.Swallow("FileTools/#3", ex); }
        }
        var top = collected
            .OrderByDescending(x => x.size)
            .Take(Math.Clamp(limit, 1, 2000))
            .Select(x => (object)new
            {
                path = x.path,
                size = (ulong)x.size,
                modified = x.modified.ToString("yyyy-MM-dd"),
            })
            .ToList();
        return new { root, count = top.Count, total_bytes = collected.Aggregate(0UL, (a, x) => a + (ulong)x.size), files = top };
    }

    // ============================ IMAGENS SIMILARES (dHash) ============================

    static readonly HashSet<string> ImageExts = new(StringComparer.OrdinalIgnoreCase)
    {
        ".jpg", ".jpeg", ".png", ".bmp", ".gif", ".webp", ".tif", ".tiff",
    };

    public static object ScanSimilarImages(string root, int threshold = 5, long minSize = 4096)
    {
        if (!Directory.Exists(root)) throw new Exception("pasta não encontrada: " + root);
        lock (_exclLock) EnsureExclusions();
        threshold = Math.Clamp(threshold, 0, 12);

        var files = new List<string>();
        foreach (var f in EnumerateAllFiles(root))
        {
            if (!ImageExts.Contains(Path.GetExtension(f))) continue;
            try
            {
                var len = new FileInfo(f).Length;
                if (len < minSize || len > 120L * 1024 * 1024) continue;
            }
            catch { continue; }
            files.Add(f);
            if (files.Count >= 20000) break;
        }

        var hashes = new System.Collections.Concurrent.ConcurrentBag<(string path, ulong hash, long size)>();
        Parallel.ForEach(files, new ParallelOptions { MaxDegreeOfParallelism = Math.Max(2, Environment.ProcessorCount - 1) }, f =>
        {
            var (h, size) = DHash(f);
            if (h.HasValue) hashes.Add((f, h.Value, size));
        });

        // agrupa por distância de Hamming
        var groups = new List<(ulong rep, List<(string path, long size)> files)>();
        foreach (var item in hashes)
        {
            int best = -1;
            for (int i = 0; i < groups.Count; i++)
            {
                if (Hamming(groups[i].rep, item.hash) <= threshold) { best = i; break; }
            }
            if (best >= 0) groups[best].files.Add((item.path, item.size));
            else groups.Add((item.hash, new List<(string, long)> { (item.path, item.size) }));
        }

        var result = groups
            .Where(g => g.files.Count >= 2)
            .OrderByDescending(g => g.files.Sum(f => f.size) - g.files.Min(f => f.size))
            .Take(500)
            .Select(g => (object)new
            {
                count = g.files.Count,
                total_bytes = g.files.Aggregate(0UL, (a, f) => a + (ulong)f.size),
                files = g.files.OrderByDescending(f => f.size)
                    .Select(f => new { path = f.path, size = (ulong)f.size }).ToList(),
            })
            .ToList();

        return new { root, threshold, scanned = files.Count, groups = result };
    }

    static int Hamming(ulong a, ulong b) => System.Numerics.BitOperations.PopCount(a ^ b);

    static (ulong? hash, long size) DHash(string path)
    {
        try
        {
            using var fs = File.OpenRead(path);
            var decoder = BitmapDecoder.Create(fs, BitmapCreateOptions.IgnoreColorProfile, BitmapCacheOption.OnLoad);
            if (decoder.Frames.Count == 0) return (null, 0);
            long size = fs.Length;
            var frame = decoder.Frames[0];
            var gray = new FormatConvertedBitmap(frame, PixelFormats.Gray8, null, 0);
            int w = gray.PixelWidth, h = gray.PixelHeight;
            if (w < 8 || h < 8) return (null, 0);
            var src = new byte[w * h];
            gray.CopyPixels(src, w, 0);

            var small = new double[8, 9];
            for (int ty = 0; ty < 8; ty++)
                for (int tx = 0; tx < 9; tx++)
                {
                    int x0 = tx * w / 9, x1 = Math.Max(x0 + 1, (tx + 1) * w / 9);
                    int y0 = ty * h / 8, y1 = Math.Max(y0 + 1, (ty + 1) * h / 8);
                    double sum = 0; int n = 0;
                    for (int y = y0; y < y1; y++)
                        for (int x = x0; x < x1; x++) { sum += src[y * w + x]; n++; }
                    small[ty, tx] = n > 0 ? sum / n : 0;
                }

            ulong hash = 0; int bit = 0;
            for (int y = 0; y < 8; y++)
                for (int x = 0; x < 8; x++)
                {
                    if (small[y, x] < small[y, x + 1]) hash |= 1UL << bit;
                    bit++;
                }
            return (hash, size);
        }
        catch { return (null, 0); }
    }

    // ============================ DEV CACHES ============================

    public static object ScanDevCaches()
    {
        string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        string roaming = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        string profile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        var items = new List<object>();

        void Add(string id, string name, string path)
        {
            try
            {
                if (!Directory.Exists(path)) return;
                ulong size = 0; int files = 0;
                Walk(path, null, ref size, ref files);
                if (size == 0 && files == 0) return;
                items.Add(new { id, name, path, size, count = files, kind = "files" });
            }
            catch (Exception ex) { Diag.Swallow("FileTools/#3", ex); }
        }

        Add("npm", "npm cache", Path.Combine(roaming, "npm-cache"));
        Add("npm_local", "npm cache (local)", Path.Combine(local, "npm-cache"));
        Add("pip", "pip cache", Path.Combine(local, "pip", "Cache"));
        Add("nuget_http", "NuGet http-cache", Path.Combine(local, "NuGet", "v3-cache"));
        Add("nuget", "NuGet cache", Path.Combine(local, "NuGet", "Cache"));
        Add("cargo_registry", "Cargo registry cache", Path.Combine(profile, ".cargo", "registry", "cache"));
        Add("cargo_git", "Cargo git db", Path.Combine(profile, ".cargo", "git", "db"));
        Add("gradle", "Gradle caches", Path.Combine(profile, ".gradle", "caches"));
        Add("yarn", "Yarn cache", Path.Combine(local, "Yarn", "Cache"));
        Add("pnpm", "pnpm store", Path.Combine(local, "pnpm", "store"));
        Add("go", "Go module cache", Path.Combine(profile, "go", "pkg", "mod", "cache"));
        Add("vscode_cache", "VS Code cache", Path.Combine(roaming, "Code", "Cache"));
        Add("vscode_cacheddata", "VS Code CachedData", Path.Combine(roaming, "Code", "CachedData"));

        // Docker: só relata (limpeza via docker system prune)
        try
        {
            string df = RunCaptured("docker", "system df --format \"{{.Type}}|{{.Size}}|{{.Reclaimable}}\"", 30000).Trim();
            if (!string.IsNullOrWhiteSpace(df))
                items.Add(new { id = "docker", name = "Docker (system prune)", path = "docker system df", size = (ulong)0, count = 0, kind = "docker", detail = df });
        }
        catch (Exception ex) { Diag.Swallow("FileTools/#4", ex); }

        ulong total = items.Aggregate(0UL, (a, x) =>
        {
            var p = x.GetType().GetProperty("size");
            return a + (p != null ? (ulong)(p.GetValue(x) ?? 0UL) : 0UL);
        });
        return new { items, total = total };
    }

    public static object CleanDevCache(string id)
    {
        if (id == "docker")
        {
            string output = RunCaptured("docker", "system prune -f", 300000).Trim();
            return new { ok = true, freed_bytes = (ulong)0, count = 0, output };
        }

        string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        string roaming = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        string profile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["npm"] = Path.Combine(roaming, "npm-cache"),
            ["npm_local"] = Path.Combine(local, "npm-cache"),
            ["pip"] = Path.Combine(local, "pip", "Cache"),
            ["nuget_http"] = Path.Combine(local, "NuGet", "v3-cache"),
            ["nuget"] = Path.Combine(local, "NuGet", "Cache"),
            ["cargo_registry"] = Path.Combine(profile, ".cargo", "registry", "cache"),
            ["cargo_git"] = Path.Combine(profile, ".cargo", "git", "db"),
            ["gradle"] = Path.Combine(profile, ".gradle", "caches"),
            ["yarn"] = Path.Combine(local, "Yarn", "Cache"),
            ["pnpm"] = Path.Combine(local, "pnpm", "store"),
            ["go"] = Path.Combine(profile, "go", "pkg", "mod", "cache"),
            ["vscode_cache"] = Path.Combine(roaming, "Code", "Cache"),
            ["vscode_cacheddata"] = Path.Combine(roaming, "Code", "CachedData"),
        };
        if (!map.TryGetValue(id, out var path) || !Directory.Exists(path))
            throw new Exception("cache não encontrado: " + id);

        ulong size = 0; int files = 0;
        Walk(path, null, ref size, ref files);
        try { Directory.Delete(path, true); }
        catch (Exception ex) { throw new Exception("não foi possível limpar (arquivos em uso?): " + ex.Message); }
        return new { ok = true, freed_bytes = size, count = files };
    }
}