# Runs scripts/enrich.ts against the Neon PRODUCTION branch (approved by the user 2026-10-06).
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
Set-Location (Resolve-Path "$PSScriptRoot\..\..")
foreach ($line in Get-Content .env.local) {
  if ($line -match '^(NEON_PROD_DATABASE_URL|TMDB_READ_TOKEN)=(.*)$') { Set-Item -Path "env:$($Matches[1])" -Value $Matches[2].Trim() }
}
$env:DATABASE_URL = $env:NEON_PROD_DATABASE_URL
"target: $(([uri]$env:DATABASE_URL).Host.Split('.')[0])"
$env:NODE_NO_WARNINGS = '1'
npx tsx --conditions=react-server scripts/enrich.ts --cloud --production 2>&1
