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
