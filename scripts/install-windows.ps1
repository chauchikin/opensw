# Installs the newest opensw build on this Windows computer, without anyone at the screen:
# gets the build branch, checks the installer against SHA256SUMS.txt, closes the open editor windows,
# moves the running opensw.exe aside (an AI app's MCP connection may still be using it) and runs
# the installer silently as a scheduled task of its own, then checks the new opensw.exe is there.
#
#   powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1 -Clone <folder>
#
# -Clone       a clone of this repository kept for the build branch (sw-next-build): it is reset to it
# -InstallDir  where opensw is installed (default: %LOCALAPPDATA%\opensw, the installer's own)
# -Force       install even when that version is installed already
# -RemoveOld   delete the opensw.old-*.exe moved aside earlier (the ones still in use stay)
param(
  [Parameter(Mandatory = $true)][string]$Clone,
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'opensw'),
  [switch]$Force,
  [switch]$RemoveOld
)
$ErrorActionPreference = 'Stop'

# 1. the newest build
# (each build replaces the branch: it is fetched and checked out, not pulled; the clone holds nothing else)
git -C $Clone fetch --quiet origin sw-next-build
if ($LASTEXITCODE -ne 0) { throw "Could not update $Clone (git fetch)" }
git -C $Clone reset --quiet --hard FETCH_HEAD
if ($LASTEXITCODE -ne 0) { throw "Could not update $Clone (git reset)" }
$setup = Get-ChildItem $Clone -Filter 'opensw_*_x64-setup.exe' | Sort-Object LastWriteTime | Select-Object -Last 1
if (-not $setup) { throw "No opensw_*_x64-setup.exe in $Clone" }
$version = [regex]::Match($setup.Name, 'opensw_(.+)_x64-setup\.exe').Groups[1].Value
Write-Output "Build: $($setup.Name) ($(Get-Content (Join-Path $Clone 'BUILD.txt') -ErrorAction SilentlyContinue))"

# 2. the installer is the one the build made
$sums = Get-Content (Join-Path $Clone 'SHA256SUMS.txt')
$expected = ($sums | Where-Object { $_ -match [regex]::Escape($setup.Name) + '$' }) -replace '\s.*$', ''
$actual = (Get-FileHash $setup.FullName -Algorithm SHA256).Hash.ToLower()
if (-not $expected -or $expected -ne $actual) { throw "SHA-256 of $($setup.Name) does not match SHA256SUMS.txt" }
Write-Output "SHA-256 checked: $actual"

$exe = Join-Path $InstallDir 'opensw.exe'
if ((Test-Path $exe) -and -not $Force) {
  $installed = (Get-Item $exe).VersionInfo.ProductVersion
  if ($installed -eq $version) { Write-Output "opensw $version is installed already (-Force installs it again)"; exit 0 }
}

# 3. the editor windows close (asking to save as when closed by hand); the MCP part has no window
Get-Process opensw -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | ForEach-Object { [void]$_.CloseMainWindow() }
for ($i = 0; $i -lt 20 -and (Get-Process opensw -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }); $i++) { Start-Sleep -Milliseconds 500 }
if (Get-Process opensw -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }) {
  throw 'An opensw window is still open (it may be asking whether to save): close it, then run this again'
}

# 4. a running opensw.exe cannot be replaced, but it can be renamed
$old = $null
if (Test-Path $exe) {
  $old = Join-Path $InstallDir ('opensw.old-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.exe')
  Rename-Item $exe $old
  Write-Output "Moved aside: $old"
}

# 5. the installer, silently, as a scheduled task (so it does not belong to the shell running this)
$task = 'opensw-install'
Unregister-ScheduledTask -TaskName $task -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $task -Action (New-ScheduledTaskAction -Execute $setup.FullName -Argument '/S') -Settings (New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries) | Out-Null
Start-ScheduledTask -TaskName $task
for ($i = 0; $i -lt 240; $i++) {
  Start-Sleep -Seconds 1
  if ($i -gt 2 -and (Get-ScheduledTask -TaskName $task).State -ne 'Running') { break }
}
$result = (Get-ScheduledTaskInfo -TaskName $task).LastTaskResult
Unregister-ScheduledTask -TaskName $task -Confirm:$false

# 6. the new opensw.exe
if (-not (Test-Path $exe) -or (Get-Item $exe).VersionInfo.ProductVersion -ne $version) {
  if (-not (Test-Path $exe) -and $old) { Rename-Item $old $exe } # the old one back, so opensw still starts
  throw "The installer ended ($result) but $exe is not opensw $version"
}
Write-Output "Installed opensw $((Get-Item $exe).VersionInfo.ProductVersion) in $InstallDir (installer result $result)"

if ($RemoveOld) {
  Get-ChildItem $InstallDir -Filter 'opensw.old-*.exe' | ForEach-Object {
    try { Remove-Item $_.FullName; Write-Output "Removed $($_.Name)" } catch { Write-Output "Still in use, kept: $($_.Name)" }
  }
}
