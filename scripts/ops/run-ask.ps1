# Asks the assistant one question against the Neon DEV branch, with settings from .env.local.
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Question)
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
Set-Location (Resolve-Path "$PSScriptRoot\..\..")
foreach ($line in Get-Content .env.local) {
  if ($line -match '^(DATABASE_URL|NEON_PROD_DATABASE_URL|TMDB_READ_TOKEN|ASSISTANT_DATABASE_URL|FOUNDRY_API_KEY|FOUNDRY_RESOURCE|ASSISTANT_MODEL)=(.*)$') { Set-Item -Path "env:$($Matches[1])" -Value $Matches[2].Trim() }
}
if (([uri]$env:DATABASE_URL).Host -eq ([uri]$env:NEON_PROD_DATABASE_URL).Host) { throw 'DATABASE_URL is production; refusing.' }
$env:NODE_NO_WARNINGS = '1'
npx tsx --conditions=react-server scripts/ask.ts ($Question -join ' ') 2>&1
