# Sets the assistant's secrets and settings on the SpineFind container app, from .env.local. Never prints a secret.
$az = 'C:\Program Files (x86)\Microsoft SDKs\Azure\CLI2\python.exe'
Set-Location (Resolve-Path "$PSScriptRoot\..\..")
$env = @{}
Get-Content .env.local | ? { $_ -match '^[A-Z_]+=' } | % { $i = $_.IndexOf('='); $env[$_.Substring(0, $i)] = $_.Substring($i + 1).Trim() }
foreach ($k in 'FOUNDRY_API_KEY', 'ASSISTANT_PROD_DATABASE_URL', 'NEON_PROD_DATABASE_URL') { if (-not $env[$k]) { throw "$k missing from .env.local" } }
if (([uri]$env.ASSISTANT_PROD_DATABASE_URL).Host -ne ([uri]$env.NEON_PROD_DATABASE_URL).Host) { throw 'ASSISTANT_PROD_DATABASE_URL is not on the production host' }
if (([uri]$env.ASSISTANT_PROD_DATABASE_URL).UserInfo -notlike 'spinefind_assistant:*') { throw 'ASSISTANT_PROD_DATABASE_URL is not the read-only login' }

# Python directly (not az.cmd), so values containing & survive.
& $az -IBm azure.cli containerapp secret set -n spinefind -g SpineFind --only-show-errors --output none `
  --secrets "foundry-api-key=$($env.FOUNDRY_API_KEY)" "assistant-database-url=$($env.ASSISTANT_PROD_DATABASE_URL)"
"secrets set"
& $az -IBm azure.cli containerapp update -n spinefind -g SpineFind --only-show-errors --output none `
  --set-env-vars "FOUNDRY_RESOURCE=spinefind-ai" "ASSISTANT_MODEL=claude-sonnet-5-5" "ASSISTANT_DAILY_LIMIT_USD=2" `
  "FOUNDRY_API_KEY=secretref:foundry-api-key" "ASSISTANT_DATABASE_URL=secretref:assistant-database-url"
"env set"
# Check lengths match without printing values.
$names = & $az -IBm azure.cli containerapp secret list -n spinefind -g SpineFind --query "[].name" -o tsv
"secrets on app: $($names -join ', ')"
$env = $null
