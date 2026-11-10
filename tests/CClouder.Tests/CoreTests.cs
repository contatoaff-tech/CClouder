using System.IO;
using System.Security.Cryptography;
using Xunit;

namespace CClouder.Tests;

public sealed class FirefoxCacheTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "cclouder-test-" + Guid.NewGuid().ToString("N"));

    private (string roaming, string local, string profile) CreateInstall(bool withProfilesIni, bool relative = true)
    {
        var roaming = Path.Combine(_root, "Roaming");
        var local = Path.Combine(_root, "Local");
        var profile = Path.Combine(roaming, "Mozilla", "Firefox", "Profiles", "abc.default");
        Directory.CreateDirectory(Path.Combine(profile, "cache2", "entries"));
        Directory.CreateDirectory(Path.Combine(profile, "storage", "default"));
        if (withProfilesIni)
        {
            Directory.CreateDirectory(Path.Combine(roaming, "Mozilla", "Firefox"));
            var path = relative ? "Profiles/abc.default" : profile.Replace("\\", "\\\\");
            File.WriteAllText(Path.Combine(roaming, "Mozilla", "Firefox", "profiles.ini"),
                $"[General]\nStartWithLastProfile=1\n\n[Profile0]\nName=default\nIsRelative={(relative ? 1 : 0)}\nPath={path}\n");
        }
        return (roaming, local, profile);
    }

    [Theory]
    [InlineData(true, true)]
    [InlineData(true, false)]
    [InlineData(false, true)]
    public void Finds_cache2_only_for_each_profile(bool withIni, bool relative)
    {
        var (roaming, local, profile) = CreateInstall(withIni, relative);

        var caches = Backend.FirefoxCacheDirectories(roaming, local);

        var cache = Assert.Single(caches);
        Assert.Equal(Path.Combine(profile, "cache2"), cache, ignoreCase: true);
    }

    [Fact]
    public void Ignores_profiles_that_only_have_a_profile_without_cache2()
    {
        var (roaming, local, profile) = CreateInstall(withProfilesIni: true);
        Directory.Delete(Path.Combine(profile, "cache2"), recursive: true);

        Assert.Empty(Backend.FirefoxCacheDirectories(roaming, local));
    }

    [Fact]
    public void Cleaning_keeps_bookmarks_preferences_and_site_data()
    {
        var (_, _, profile) = CreateInstall(withProfilesIni: true);
        File.WriteAllText(Path.Combine(profile, "cache2", "entries", "cached.bin"), "cache");
        File.WriteAllText(Path.Combine(profile, "places.sqlite"), "bookmarks");
        File.WriteAllText(Path.Combine(profile, "prefs.js"), "prefs");
        File.WriteAllText(Path.Combine(profile, "storage", "default", "site.sqlite"), "site");

        ulong freed = 0;
        int count = 0;
        Backend.CleanWalk(Path.Combine(profile, "cache2"), null, ref freed, ref count);

        Assert.False(File.Exists(Path.Combine(profile, "cache2", "entries", "cached.bin")));
        Assert.True(File.Exists(Path.Combine(profile, "places.sqlite")));
        Assert.True(File.Exists(Path.Combine(profile, "prefs.js")));
        Assert.True(File.Exists(Path.Combine(profile, "storage", "default", "site.sqlite")));
    }

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, true);
    }
}

public sealed class CleanSelectedTests
{
    [Fact]
    public void Unknown_item_ids_do_not_resolve()
    {
        Assert.Null(Backend.ResolveCleanItem("does-not-exist"));
        Assert.NotNull(Backend.ResolveCleanItem("temp"));
    }

    [Fact]
    public void Payload_cannot_override_the_catalog_path()
    {
        // TEMP aponta para o sandbox: o item "temp" limpa só ele.
        var root = Path.Combine(Path.GetTempPath(), "cclouder-test-" + Guid.NewGuid().ToString("N"));
        var sandbox = Path.Combine(root, "temp-sandbox");
        Directory.CreateDirectory(sandbox);
        File.WriteAllText(Path.Combine(sandbox, "deletable.txt"), "cache");

        var sentinel = Path.Combine(root, "sentinel.txt");
        File.WriteAllText(sentinel, "must survive");

        var originalTemp = Environment.GetEnvironmentVariable("TEMP");
        try
        {
            Environment.SetEnvironmentVariable("TEMP", sandbox);
            var json = $$"""{"items":[{"id":"temp","name":"x","path":"{{sentinel.Replace("\\", "\\\\")}}","checked":true}]}""";
            using var doc = System.Text.Json.JsonDocument.Parse(json);

            Backend.CleanSelected(doc.RootElement);

            Assert.True(File.Exists(sentinel), "o caminho enviado pela interface não pode ser usado");
            Assert.False(File.Exists(Path.Combine(sandbox, "deletable.txt")), "o item canônico deve ser limpo");
        }
        finally
        {
            Environment.SetEnvironmentVariable("TEMP", originalTemp);
            if (Directory.Exists(root)) Directory.Delete(root, true);
        }
    }
}

public sealed class ManualDeleteGuardTests
{
    [Fact]
    public void Rejects_windows_and_program_files()
    {
        var windows = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
        var programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        Assert.ThrowsAny<Exception>(() => Backend.ValidateManualDeletePath(windows));
        Assert.ThrowsAny<Exception>(() => Backend.ValidateManualDeletePath(Path.Combine(programFiles, "qualquer")));
    }

    [Fact]
    public void Rejects_missing_paths_and_drive_roots()
    {
        Assert.ThrowsAny<Exception>(() => Backend.ValidateManualDeletePath(Path.Combine(Path.GetTempPath(), "nao-existe-" + Guid.NewGuid().ToString("N"))));
        var root = Path.GetPathRoot(Path.GetTempPath());
        if (!string.IsNullOrEmpty(root))
            Assert.ThrowsAny<Exception>(() => Backend.ValidateManualDeletePath(root));
    }

    [Fact]
    public void Accepts_and_deletes_a_temporary_folder()
    {
        var dir = Path.Combine(Path.GetTempPath(), "cclouder-del-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path.Combine(dir, "sub"));
        File.WriteAllText(Path.Combine(dir, "sub", "a.txt"), "x");
        try
        {
            var result = Backend.DeleteFiles([dir]);
            Assert.False(Directory.Exists(dir));
            Assert.Contains("deleted = 1", result.ToString());
        }
        finally
        {
            if (Directory.Exists(dir)) Directory.Delete(dir, true);
        }
    }
}

public sealed class UpdateVerificationTests
{
    private static byte[] FakeExe(int size = 4096)
    {
        var bytes = new byte[size];
        bytes[0] = (byte)'M';
        bytes[1] = (byte)'Z';
        RandomNumberGenerator.Fill(bytes.AsSpan(2));
        return bytes;
    }

    private static string Digest(byte[] bytes) => "sha256:" + Convert.ToHexString(SHA256.HashData(bytes));

    [Fact]
    public void Accepts_matching_digest_and_size()
    {
        var bytes = FakeExe();
        Backend.VerifyUpdateBytes(bytes, bytes.Length, Digest(bytes));
    }

    [Fact]
    public void Rejects_tampered_digest()
    {
        var bytes = FakeExe();
        Assert.ThrowsAny<Exception>(() => Backend.VerifyUpdateBytes(bytes, bytes.Length, "sha256:" + new string('0', 64)));
    }

    [Fact]
    public void Rejects_missing_digest_and_wrong_size()
    {
        var bytes = FakeExe();
        Assert.ThrowsAny<Exception>(() => Backend.VerifyUpdateBytes(bytes, bytes.Length, ""));
        Assert.ThrowsAny<Exception>(() => Backend.VerifyUpdateBytes(bytes, bytes.Length + 1, Digest(bytes)));
    }

    [Fact]
    public void Rejects_non_executable_payload()
    {
        var bytes = new byte[4096];
        Assert.ThrowsAny<Exception>(() => Backend.VerifyUpdateBytes(bytes, bytes.Length, Digest(bytes)));
    }
}
