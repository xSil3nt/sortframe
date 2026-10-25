using System.Diagnostics;
using System.Net;
using System.Text;

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
