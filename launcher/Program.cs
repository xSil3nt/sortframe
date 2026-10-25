using System.Diagnostics;
using System.Net;
using System.IO.Pipes;
using System.Text;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using System.Drawing;
using System.Windows.Forms;

[STAThread]
if (args.Length == 2 && args[0] == "--steam-auth")
{
    await RunSteamAuth(args[1]);
    return;
}

const int firstPort = 4175;
var mutex = new Mutex(true, @"Local\Sortframe.Local.Server", out var created);
var dataPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Sortframe");
Directory.CreateDirectory(dataPath);
var portFile = Path.Combine(dataPath, "runtime.port");

if (!created)
{
    var current = await FindRunningPort();
    if (current is not null) OpenBrowser(current.Value);
    return;
}

var runningPort = await FindRunningPort();
if (runningPort is null)
{
    var root = AppContext.BaseDirectory;
    var node = Path.Combine(root, "runtime", "node.exe");
    var server = Path.Combine(root, "app", "dist", "server", "index.js");
    if (!File.Exists(node) || !File.Exists(server))
    {
        MessageBox.Show("Sortframe could not find its local runtime files. Reinstall the app or extract the portable ZIP again.", "Sortframe", MessageBoxButtons.OK, MessageBoxIcon.Error);
        return;
    }

    var start = new ProcessStartInfo(node) { UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = Path.Combine(root, "app") };
    start.ArgumentList.Add("--experimental-sqlite");
    start.ArgumentList.Add(server);
    start.Environment["NODE_ENV"] = "production";
    start.Environment["SORTFRAME_DATA_DIR"] = dataPath;
    start.Environment["SORTFRAME_READY_FILE"] = portFile;
    start.Environment["SORTFRAME_LAUNCHER_PATH"] = Path.Combine(root, "Sortframe.exe");
    try { Process.Start(start); }
    catch (Exception ex)
    {
        MessageBox.Show($"Sortframe could not start its local service: {ex.Message}", "Sortframe", MessageBoxButtons.OK, MessageBoxIcon.Error);
        return;
    }
    runningPort = await WaitForServer(portFile);
}

if (runningPort is null)
{
    MessageBox.Show("Sortframe did not start in time. Try closing the app and opening it again.", "Sortframe", MessageBoxButtons.OK, MessageBoxIcon.Error);
    return;
}
OpenBrowser(runningPort.Value);

static async Task<int?> FindRunningPort()
{
    using var client = new HttpClient { Timeout = TimeSpan.FromMilliseconds(250) };
    for (var port = firstPort; port < firstPort + 10; port++)
    {
        try
        {
            using var response = await client.GetAsync($"http://127.0.0.1:{port}/api/health");
            if (response.StatusCode == HttpStatusCode.OK && (await response.Content.ReadAsStringAsync()).Contains("\"ok\":true", StringComparison.Ordinal)) return port;
        }
        catch { }
    }
    return null;
}

static async Task<int?> WaitForServer(string portFile)
{
    for (var attempt = 0; attempt < 100; attempt++)
    {
        var active = await FindRunningPort();
        if (active is not null) return active;
        if (File.Exists(portFile) && int.TryParse(await File.ReadAllTextAsync(portFile, Encoding.UTF8), out var port))
        {
            using var client = new HttpClient { Timeout = TimeSpan.FromMilliseconds(250) };
            try
            {
                using var response = await client.GetAsync($"http://127.0.0.1:{port}/api/health");
                if (response.IsSuccessStatusCode) return port;
            }
            catch { }
        }
        await Task.Delay(200);
    }
    return null;
}

static void OpenBrowser(int port)
{
    try { Process.Start(new ProcessStartInfo($"http://127.0.0.1:{port}") { UseShellExecute = true }); }
    catch (Exception ex) { MessageBox.Show($"Sortframe is running at http://127.0.0.1:{port}, but the browser could not open: {ex.Message}", "Sortframe", MessageBoxButtons.OK, MessageBoxIcon.Information); }
}

static async Task RunSteamAuth(string pipeName)
{
    if (!System.Text.RegularExpressions.Regex.IsMatch(pipeName, "^Sortframe-[A-Fa-f0-9]{32}$")) return;
    var form = new Form { Text = "Sign in with Steam", Width = 520, Height = 680, MinimumSize = new Size(430, 560), StartPosition = FormStartPosition.CenterScreen };
    var header = new Label { Text = "Steam sign in happens on steamcommunity.com. Warframe receives the return at mobile.warframe.com.", Dock = DockStyle.Top, Height = 50, Padding = new Padding(12, 9, 12, 6), AutoSize = false };
    var cancel = new Button { Text = "Cancel", Dock = DockStyle.Bottom, Height = 38 };
    var browser = new WebView2 { Dock = DockStyle.Fill };
    form.Controls.Add(browser);
    form.Controls.Add(cancel);
    form.Controls.Add(header);
    var completed = false;
    string? profile = null;
    async Task SendResult(string? code)
    {
        if (completed) return;
        completed = true;
        await using var pipe = new NamedPipeClientStream(".", pipeName, PipeDirection.Out, PipeOptions.Asynchronous);
        await pipe.ConnectAsync(30000);
        await JsonSerializer.SerializeAsync(pipe, new { code, cancelled = code is null });
        await pipe.FlushAsync();
    }

    cancel.Click += async (_, _) =>
    {
        try { await SendResult(null); } catch { }
        form.Close();
    };
    form.FormClosing += async (_, eventArgs) =>
    {
        if (completed) return;
        eventArgs.Cancel = true;
        try { await SendResult(null); } catch { }
        form.Close();
    };
    form.Shown += async (_, _) =>
    {
        try
        {
            profile = Path.Combine(Path.GetTempPath(), "Sortframe-Steam-" + Guid.NewGuid().ToString("N"));
            var environment = await CoreWebView2Environment.CreateAsync(null, profile);
            await browser.EnsureCoreWebView2Async(environment);
            browser.CoreWebView2.NavigationStarting += async (_, navigation) =>
            {
                if (!Uri.TryCreate(navigation.Uri, UriKind.Absolute, out var uri) || !uri.Host.Equals("mobile.warframe.com", StringComparison.OrdinalIgnoreCase) || uri.AbsolutePath != "/api/mobileSteamAuth.php") return;
                navigation.Cancel = true;
                var code = System.Web.HttpUtility.ParseQueryString(uri.Query).Get("code");
                if (string.IsNullOrWhiteSpace(code) || code.Length > 512 || !System.Text.RegularExpressions.Regex.IsMatch(code, "^[A-Za-z0-9._~-]+$"))
                {
                    MessageBox.Show(form, "Steam did not return a usable Warframe authorization code. Close this window and try again.", "Sortframe", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    return;
                }
                try { await SendResult(code); form.Close(); }
                catch { MessageBox.Show(form, "The local login handoff failed. Close this window and try again.", "Sortframe", MessageBoxButtons.OK, MessageBoxIcon.Error); }
            };
            browser.Source = new Uri("https://steamcommunity.com/oauth/login?client_id=A1182243&redirect_uri=https%3A%2F%2Fmobile.warframe.com%2Fapi%2FmobileSteamAuth.php&response_type=code&mobileminimal=1&state=");
        }
        catch
        {
            var choice = MessageBox.Show(form, "Steam sign in needs Microsoft Edge WebView2 Runtime. Install the runtime from Microsoft, then retry.", "Sortframe", MessageBoxButtons.OKCancel, MessageBoxIcon.Information);
            if (choice == DialogResult.OK) Process.Start(new ProcessStartInfo("https://developer.microsoft.com/microsoft-edge/webview2/") { UseShellExecute = true });
            form.Close();
        }
    };
    Application.Run(form);
    form.Dispose();
    if (profile is not null)
    {
        try { Directory.Delete(profile, true); } catch { }
    }
}
