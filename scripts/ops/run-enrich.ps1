# Runs scripts/enrich.ts against the Neon DEV branch with settings from .env.local. Extra args pass through (e.g. --dry-run).
param([string[]]$Rest)
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
Set-Location (Resolve-Path "$PSScriptRoot\..\..")
foreach ($line in Get-Content .env.local) {
  if ($line -match '^(DATABASE_URL|NEON_PROD_DATABASE_URL|TMDB_READ_TOKEN)=(.*)$') { Set-Item -Path "env:$($Matches[1])" -Value $Matches[2].Trim() }
}
if (([uri]$env:DATABASE_URL).Host -eq ([uri]$env:NEON_PROD_DATABASE_URL).Host) { throw 'DATABASE_URL is production; refusing.' }
"target: $(([uri]$env:DATABASE_URL).Host.Split('.')[0])"
$env:NODE_NO_WARNINGS = '1'
npx tsx --conditions=react-server scripts/enrich.ts --cloud @Rest 2>&1
