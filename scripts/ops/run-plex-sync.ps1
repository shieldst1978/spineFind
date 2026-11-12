# Syncs the Plex film library on this PC into SpineFind (scripts/plex-sync.ts), with settings from .env.local.
# The Plex token is read from Plex Media Server's own registry entry and never printed or stored elsewhere.
# Dev branch by default; -Production updates live data (what the nightly task runs). Extra arguments pass through (e.g. --dry-run).
param([switch]$Production, [string]$Log, [Parameter(ValueFromRemainingArguments = $true)][string[]]$Rest)
$ErrorActionPreference = 'Stop'
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
Set-Location (Resolve-Path "$PSScriptRoot\..\..")
if ($Log) { Start-Transcript -Path $Log -Append | Out-Null }
try {
  foreach ($line in Get-Content .env.local) {
    if ($line -match '^(DATABASE_URL|NEON_PROD_DATABASE_URL|TMDB_READ_TOKEN)=(.*)$') { Set-Item -Path "env:$($Matches[1])" -Value $Matches[2].Trim() }
  }
  $env:PLEX_TOKEN = (Get-ItemProperty 'HKCU:\Software\Plex, Inc.\Plex Media Server').PlexOnlineToken
  if (-not $env:PLEX_TOKEN) { throw 'No Plex token found: is Plex Media Server signed in on this PC?' }
  $extra = @('--cloud')
  if ($Production) { $env:DATABASE_URL = $env:NEON_PROD_DATABASE_URL; $extra += '--production' }
  elseif (([uri]$env:DATABASE_URL).Host -eq ([uri]$env:NEON_PROD_DATABASE_URL).Host) { throw 'DATABASE_URL is production; use -Production deliberately.' }
  "$(Get-Date -Format s) target: $(([uri]$env:DATABASE_URL).Host.Split('.')[0])"
  $env:NODE_NO_WARNINGS = '1'
  npx tsx --conditions=react-server scripts/plex-sync.ts @extra @Rest 2>&1
  if ($LASTEXITCODE) { throw "plex-sync exited with $LASTEXITCODE" }
} finally {
  if ($Log) { Stop-Transcript | Out-Null }
}
