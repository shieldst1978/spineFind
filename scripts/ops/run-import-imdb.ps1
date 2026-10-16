# Imports the IMDb watch history as "films seen" (scripts/import-imdb.ts), with settings from .env.local.
# Dev branch by default; -Production runs it against live data. Extra arguments pass through (e.g. --dry-run, a CSV path).
param([switch]$Production, [Parameter(ValueFromRemainingArguments = $true)][string[]]$Rest)
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
Set-Location (Resolve-Path "$PSScriptRoot\..\..")
foreach ($line in Get-Content .env.local) {
  if ($line -match '^(DATABASE_URL|NEON_PROD_DATABASE_URL|TMDB_READ_TOKEN)=(.*)$') { Set-Item -Path "env:$($Matches[1])" -Value $Matches[2].Trim() }
}
$extra = @('--cloud')
if ($Production) { $env:DATABASE_URL = $env:NEON_PROD_DATABASE_URL; $extra += '--production' }
elseif (([uri]$env:DATABASE_URL).Host -eq ([uri]$env:NEON_PROD_DATABASE_URL).Host) { throw 'DATABASE_URL is production; use -Production deliberately.' }
"target: $(([uri]$env:DATABASE_URL).Host.Split('.')[0])"
$env:NODE_NO_WARNINGS = '1'
npx tsx --conditions=react-server scripts/import-imdb.ts @extra @Rest 2>&1
