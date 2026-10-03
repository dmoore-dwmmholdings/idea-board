# Idea Board - Windows installer. Built by scripts/build-installer.js: edit this template, not install.ps1.
#
# Run from an elevated PowerShell (Run as Administrator):
#   irm https://raw.githubusercontent.com/dmoore-dwmmholdings/idea-board/main/install.ps1 | iex
#
# Safe to re-run: it updates the app and keeps your ideas. Optional settings, set before running:
#   $env:BOARD_PORT = 4321                 # port to serve on
#   $env:BOARD_ALLOW_FROM = 'LocalSubnet'  # firewall source: LocalSubnet, Any, or comma-separated IPs/CIDRs
#   $env:BOARD_UNINSTALL = 1               # remove the service, app and firewall rule (keeps data)

& {
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$Service   = 'IdeaBoard'
$RuleName  = 'IdeaBoard-HTTP'
$Port      = if ($env:BOARD_PORT) { [int]$env:BOARD_PORT } else { 4321 }
$AllowFrom = if ($env:BOARD_ALLOW_FROM) { $env:BOARD_ALLOW_FROM -split '\s*,\s*' } else { @('LocalSubnet') }
$Root      = Join-Path $env:ProgramFiles 'IdeaBoard'
$AppDir    = Join-Path $Root 'app'
$Nssm      = Join-Path $Root 'nssm.exe'
$StateDir  = Join-Path $env:ProgramData 'IdeaBoard'
$DataDir   = Join-Path $StateDir 'data'
$LogDir    = Join-Path $StateDir 'logs'
$LogFile   = Join-Path $LogDir 'service.log'
# Not $env:TEMP: a caller such as Git Bash can hand PowerShell a TEMP that does not exist.
$WorkDir   = Join-Path $StateDir 'tmp'
$NssmUrl   = if ($env:NSSM_URL) { $env:NSSM_URL } else { 'https://nssm.cc/release/nssm-2.24.zip' }

function Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }

function Invoke-Nssm {
  & $Nssm @args | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "nssm $($args -join ' ') failed (exit $LASTEXITCODE)" }
}

function Get-WithRetry($url, $outFile) {
  for ($i = 1; $i -le 3; $i++) {
    try { Invoke-WebRequest $url -OutFile $outFile -UseBasicParsing; return }
    catch { if ($i -eq 3) { throw "Download failed: $url ($($_.Exception.Message))" }; Start-Sleep -Seconds (2 * $i) }
  }
}

# Prefer the machine-wide install so the service (LocalSystem) can always reach it.
function Get-NodeExe {
  $candidates = @(Join-Path $env:ProgramFiles 'nodejs\node.exe')
  $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($cmd) { $candidates += $cmd.Source }
  foreach ($exe in $candidates) {
    if (Test-Path $exe) {
      $major = [int]((& $exe -v).TrimStart('v').Split('.')[0])
      if ($major -ge 18) { return $exe }
    }
  }
}

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host 'Run this from an elevated PowerShell (right-click > Run as Administrator).' -ForegroundColor Red
  return
}

# ---------- uninstall ----------

if ($env:BOARD_UNINSTALL) {
  Remove-Item Env:BOARD_UNINSTALL
  Step 'Removing Idea Board'
  if (Get-Service $Service -ErrorAction SilentlyContinue) {
    Stop-Service $Service -Force -ErrorAction SilentlyContinue
    if (Test-Path $Nssm) { & $Nssm remove $Service confirm | Out-Null } else { sc.exe delete $Service | Out-Null }
  }
  Get-NetFirewallRule -Name $RuleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  Remove-Item $Root -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host "Removed. Your ideas are still in $DataDir" -ForegroundColor Green
  return
}

# ---------- node ----------

New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null

$node = Get-NodeExe
if (-not $node) {
  Step 'Installing Node.js LTS'
  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
  # Parentheses make PowerShell 5.1 enumerate the JSON array instead of passing it as one object.
  $release = (Invoke-RestMethod 'https://nodejs.org/dist/index.json' -UseBasicParsing) | Where-Object { $_.lts } | Select-Object -First 1
  $msi = Join-Path $WorkDir "node-$($release.version)-$arch.msi"
  Get-WithRetry "https://nodejs.org/dist/$($release.version)/node-$($release.version)-$arch.msi" $msi
  $proc = Start-Process msiexec.exe -ArgumentList '/i', "`"$msi`"", '/qn', '/norestart' -Wait -PassThru
  Remove-Item $msi -Force -ErrorAction SilentlyContinue
  if ($proc.ExitCode -notin 0, 3010) { throw "Node.js installer failed (exit $($proc.ExitCode))" }
  $node = Get-NodeExe
  if (-not $node) { throw 'Node.js was installed but node.exe was not found.' }
}
Step "Using Node $(& $node -v) at $node"

# ---------- nssm ----------

New-Item -ItemType Directory -Force -Path $Root, $AppDir, $DataDir, $LogDir | Out-Null
if (-not (Test-Path $Nssm)) {
  Step 'Downloading NSSM'
  $zip = Join-Path $WorkDir 'nssm.zip'
  $tmp = Join-Path $WorkDir 'nssm-extract'
  Get-WithRetry $NssmUrl $zip
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
  Expand-Archive $zip -DestinationPath $tmp -Force
  $flavor = if ([Environment]::Is64BitOperatingSystem) { 'win64' } else { 'win32' }
  $exe = Get-ChildItem $tmp -Recurse -Filter nssm.exe | Where-Object { $_.Directory.Name -eq $flavor } | Select-Object -First 1
  if (-not $exe) { throw "nssm.exe ($flavor) not found in $NssmUrl" }
  Copy-Item $exe.FullName $Nssm -Force
  Remove-Item $zip, $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

# ---------- app ----------

$existing = Get-Service $Service -ErrorAction SilentlyContinue
if ($existing -and $existing.Status -ne 'Stopped') {
  Step 'Stopping running service'
  Stop-Service $Service -Force
}

Step "Writing app to $AppDir"
Get-ChildItem $AppDir -Force | Remove-Item -Recurse -Force
$files = @{
__FILES__
}
foreach ($rel in $files.Keys) {
  $dest = Join-Path $AppDir $rel
  New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
  [IO.File]::WriteAllBytes($dest, [Convert]::FromBase64String($files[$rel]))
}

$seed = '__SEED__'
$dataFile = Join-Path $DataDir 'ideas.json'
if ($seed -and -not (Test-Path $dataFile)) {
  Step "Seeding $dataFile"
  [IO.File]::WriteAllBytes($dataFile, [Convert]::FromBase64String($seed))
}

# ---------- service ----------

Step "Configuring service '$Service'"
if (-not $existing) { Invoke-Nssm install $Service $node }
Invoke-Nssm set $Service Application $node
Invoke-Nssm set $Service AppParameters server.js
Invoke-Nssm set $Service AppDirectory $AppDir
Invoke-Nssm set $Service AppEnvironmentExtra 'HOST=0.0.0.0' "PORT=$Port" "DATA_DIR=$DataDir"
Invoke-Nssm set $Service DisplayName 'Idea Board'
Invoke-Nssm set $Service Description "Idea Board web app on port $Port"
Invoke-Nssm set $Service Start SERVICE_AUTO_START
Invoke-Nssm set $Service AppExit Default Restart
Invoke-Nssm set $Service AppRestartDelay 2000
Invoke-Nssm set $Service AppStdout $LogFile
Invoke-Nssm set $Service AppStderr $LogFile
Invoke-Nssm set $Service AppRotateFiles 1
Invoke-Nssm set $Service AppRotateOnline 1
Invoke-Nssm set $Service AppRotateBytes 1048576

Step "Allowing TCP $Port through Windows Firewall from $($AllowFrom -join ', ')"
Get-NetFirewallRule -Name $RuleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -Name $RuleName -DisplayName 'Idea Board' -Direction Inbound -Protocol TCP `
  -LocalPort $Port -RemoteAddress $AllowFrom -Action Allow -Profile Any | Out-Null

Step 'Starting service'
Start-Service $Service
$up = $false
for ($i = 0; $i -lt 20 -and -not $up; $i++) {
  Start-Sleep -Milliseconds 500
  try { Invoke-WebRequest "http://127.0.0.1:$Port/api/ideas" -UseBasicParsing -TimeoutSec 2 | Out-Null; $up = $true } catch {}
}
if (-not $up) { throw "The service started but is not answering on port $Port. See $LogFile" }

$ips = Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
  Select-Object -ExpandProperty IPAddress

Write-Host ''
Write-Host 'Idea Board is running as a Windows service and starts on boot. Open it from your machine:' -ForegroundColor Green
Write-Host "  http://$($env:COMPUTERNAME):$Port"
foreach ($ip in $ips) { Write-Host "  http://${ip}:$Port" }
Write-Host ''
Write-Host "  Data: $dataFile"
Write-Host "  Logs: $LogFile"
Write-Host "  Manage: Restart-Service $Service  |  Stop-Service $Service  |  & '$Nssm' edit $Service"
}
