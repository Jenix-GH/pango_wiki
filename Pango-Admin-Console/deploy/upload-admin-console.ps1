[CmdletBinding()]
param(
  [string]$ConfigFile = '',
  [switch]$SkipLocalChecks,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$adminRoot = Split-Path -Parent $PSScriptRoot
$ConfigFile = if ($ConfigFile) { $ConfigFile } else { Join-Path $PSScriptRoot 'upload-admin-console.psd1' }
$archivePath = $null
$remoteScriptPath = $null

function Invoke-CheckedCommand {
  param(
    [Parameter(Mandatory)][string]$Command,
    [Parameter(Mandatory)][string[]]$CommandArguments,
    [string]$WorkingDirectory = ''
  )
  if ($WorkingDirectory) { Push-Location -LiteralPath $WorkingDirectory }
  try {
    & $Command @CommandArguments
    if ($LASTEXITCODE -ne 0) { throw "Command failed with exit code ${LASTEXITCODE}: $Command" }
  } finally {
    if ($WorkingDirectory) { Pop-Location }
  }
}

function Required-Setting {
  param([hashtable]$Settings, [string]$Name)
  $value = [string]$Settings[$Name]
  if ([string]::IsNullOrWhiteSpace($value)) { throw "Deployment config is missing $Name" }
  return $value.Trim()
}

function Assert-SafeRemotePath {
  param([string]$Path)
  if ($Path -notmatch '^/[A-Za-z0-9._/-]+$') { throw 'RemotePath must be a Linux absolute path without spaces or special characters' }
  if ($Path -match '(^|/)\.\.(/|$)') { throw 'RemotePath must not contain a .. segment' }
  $segments = @($Path.Trim('/') -split '/' | Where-Object { $_ })
  if ($segments.Count -lt 3) { throw 'RemotePath is too broad; use the exact Pango-Admin-Console directory' }
}

try {
  if (!(Test-Path -LiteralPath $ConfigFile -PathType Leaf)) {
    throw "Deployment config not found: $ConfigFile`nCopy upload-admin-console.example.psd1 to upload-admin-console.psd1 and edit it first."
  }
  $settings = Import-PowerShellDataFile -LiteralPath $ConfigFile
  $sshHost = Required-Setting $settings 'SshHost'
  $sshUser = Required-Setting $settings 'SshUser'
  $remotePath = Required-Setting $settings 'RemotePath'
  $pm2ProcessName = Required-Setting $settings 'Pm2ProcessName'
  $sshPort = [int]$settings.SshPort
  $identityFile = [string]$settings.IdentityFile

  if ($sshHost -notmatch '^[A-Za-z0-9][A-Za-z0-9.-]*$') { throw 'Invalid SshHost' }
  if ($sshUser -notmatch '^[A-Za-z0-9._-]+$') { throw 'Invalid SshUser' }
  if ($sshPort -lt 1 -or $sshPort -gt 65535) { throw 'SshPort must be between 1 and 65535' }
  if ($pm2ProcessName -notmatch '^[A-Za-z0-9._-]+$') { throw 'Invalid Pm2ProcessName' }
  Assert-SafeRemotePath $remotePath
  $remotePath = $remotePath.TrimEnd('/')

  foreach ($command in @('tar', 'ssh', 'scp')) {
    if (!(Get-Command $command -ErrorAction SilentlyContinue)) { throw "Command not found: $command" }
  }
  if (!$SkipLocalChecks -and !(Get-Command npm -ErrorAction SilentlyContinue)) { throw 'Command not found: npm' }

  if ($identityFile) {
    $identityFile = (Resolve-Path -LiteralPath $identityFile).Path
  }

  if (!$SkipLocalChecks) {
    Write-Host 'Running local tests...' -ForegroundColor Cyan
    Invoke-CheckedCommand -Command 'npm' -CommandArguments @('test') -WorkingDirectory $adminRoot
    Write-Host 'Running local production build...' -ForegroundColor Cyan
    Invoke-CheckedCommand -Command 'npm' -CommandArguments @('run', 'build') -WorkingDirectory $adminRoot
  }

  $releaseId = (Get-Date -Format 'yyyyMMddHHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
  $archivePath = Join-Path ([IO.Path]::GetTempPath()) "pango-admin-$releaseId.tar.gz"
  $remoteScriptPath = Join-Path ([IO.Path]::GetTempPath()) "pango-admin-$releaseId.sh"

  Write-Host 'Packaging admin console source...' -ForegroundColor Cyan
  $tarArguments = @(
    '-czf', $archivePath,
    '--exclude=./config',
    '--exclude=./node_modules',
    '--exclude=./dist',
    '--exclude=./tests',
    '--exclude=./deploy',
    '--exclude=./.env',
    '--exclude=./.env.*',
    '--exclude=*.log',
    '--exclude=__pycache__',
    '--exclude=*.pyc',
    '--exclude=._*',
    '-C', $adminRoot,
    '.'
  )
  Invoke-CheckedCommand -Command 'tar' -CommandArguments $tarArguments

  $archiveEntries = @(& tar -tzf $archivePath)
  if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect upload archive' }
  $forbiddenEntries = @($archiveEntries | Where-Object {
    $_ -match '(^|/)(config|node_modules|dist|tests|deploy)(/|$)' -or $_ -match '(^|/)\.env(?:\.|$)'
  })
  if ($forbiddenEntries.Count) { throw "Archive contains excluded entries: $($forbiddenEntries -join ', ')" }

  $remoteArchive = "/tmp/pango-admin-$releaseId.tar.gz"
  $remoteScript = "/tmp/pango-admin-$releaseId.sh"
  $remoteTemplate = Join-Path $PSScriptRoot 'deploy-admin-console.sh'
  if (!(Test-Path -LiteralPath $remoteTemplate -PathType Leaf)) {
    throw 'deploy-admin-console.sh is missing; extract the complete updated admin package.'
  }
  $remoteDeployment = [IO.File]::ReadAllText($remoteTemplate) -replace "`r`n", "`n"
  [IO.File]::WriteAllText($remoteScriptPath, $remoteDeployment, [Text.UTF8Encoding]::new($false))

  Write-Host "Package created with $($archiveEntries.Count) entries." -ForegroundColor Green
  if ($DryRun) {
    Write-Host 'Dry run completed; no server connection or upload was attempted.' -ForegroundColor Yellow
    return
  }

  $sshArguments = @('-p', [string]$sshPort)
  $scpArguments = @('-P', [string]$sshPort)
  if ($identityFile) {
    $sshArguments += @('-i', $identityFile)
    $scpArguments += @('-i', $identityFile)
  }
  $remoteLogin = "$sshUser@$sshHost"

  Write-Host "Uploading to $remoteLogin..." -ForegroundColor Cyan
  Invoke-CheckedCommand -Command 'scp' -CommandArguments ($scpArguments + @($archivePath, $remoteScriptPath, "${remoteLogin}:/tmp/"))
  Write-Host 'Building and switching the release on the server...' -ForegroundColor Cyan
  Invoke-CheckedCommand -Command 'ssh' -CommandArguments ($sshArguments + @($remoteLogin, "bash -n '$remoteScript' && bash '$remoteScript' '$remotePath' '$pm2ProcessName' '$releaseId'"))
  Write-Host 'Deployment succeeded in preparation mode. Email sending is disabled; previous code/config backups were retained.' -ForegroundColor Green
} finally {
  foreach ($temporaryFile in @($archivePath, $remoteScriptPath)) {
    if ($temporaryFile -and (Test-Path -LiteralPath $temporaryFile -PathType Leaf)) {
      Remove-Item -LiteralPath $temporaryFile -Force
    }
  }
}
