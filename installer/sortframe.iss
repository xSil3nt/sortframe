#define AppName "Sortframe"
#define AppVersion "0.1.0"
#define AppPublisher "xSil3nt"
#define AppExeName "Sortframe.exe"

[Setup]
AppId={{B52DA7B7-7D63-4BD0-8764-83DE48710891}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={autopf}\Sortframe
DefaultGroupName=Sortframe
OutputDir=..\release
OutputBaseFilename=Sortframe-Setup-{#AppVersion}-x64
ArchitecturesInstallIn64BitMode=x64
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
Uninstallable=yes

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"; Flags: unchecked

[Files]
Source: "..\stage\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Sortframe"; Filename: "{app}\Sortframe.exe"
Name: "{autodesktop}\Sortframe"; Filename: "{app}\Sortframe.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\Sortframe.exe"; Description: "Launch Sortframe"; Flags: postinstall nowait skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}\runtime"

[Code]
function IsWebView2Installed(): Boolean;
var
  Version: String;
begin
  Result := RegQueryStringValue(HKLM32, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version);
  if not Result then
    Result := RegQueryStringValue(HKCU, 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version);
  Result := Result and (Version <> '') and (Version <> '0.0.0.0');
end;

function InitializeSetup(): Boolean;
var
  ResultCode: Integer;
begin
  Result := True;
  if not IsWebView2Installed() and (MsgBox('Sortframe uses Microsoft WebView2 Runtime for Steam sign in. It is not installed. Open Microsoft''s download page?', mbConfirmation, MB_YESNO) = IDYES) then
    ShellExec('open', 'https://developer.microsoft.com/microsoft-edge/webview2/', '', '', SW_SHOWNORMAL, ewNoWait, ResultCode);
end;
