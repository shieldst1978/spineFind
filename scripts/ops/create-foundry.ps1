# Creates the SpineFind Foundry account (Sweden Central) and a Claude Sonnet 5.5 deployment.
# Approved by the user 2026-10-12: attestation Tim Shields / GB / technology, region Sweden Central.
$az = 'C:\Program Files (x86)\Microsoft SDKs\Azure\CLI2\python.exe'
$sub = (& $az -IBm azure.cli account show --query id -o tsv)
$base = "https://management.azure.com/subscriptions/$sub/resourceGroups/SpineFind/providers/Microsoft.CognitiveServices/accounts/spinefind-ai"
$api = "api-version=2025-10-01-preview"
$tmp = Join-Path $PSScriptRoot 'foundry-body.json'

@{
  location = 'swedencentral'
  kind = 'AIServices'
  sku = @{ name = 'S0' }
  identity = @{ type = 'SystemAssigned' }
  tags = @{ app = 'spinefind' }
  properties = @{ customSubDomainName = 'spinefind-ai'; allowProjectManagement = $true; publicNetworkAccess = 'Enabled'; disableLocalAuth = $false }
} | ConvertTo-Json -Depth 5 | Set-Content $tmp
"creating account..."
& $az -IBm azure.cli rest --method put --url "$base`?$api" --body "@$tmp" --query "{name:name, state:properties.provisioningState, endpoint:properties.endpoint}" -o json
for ($i = 0; $i -lt 30; $i++) {
  $state = & $az -IBm azure.cli rest --method get --url "$base`?$api" --query properties.provisioningState -o tsv
  if ($state -in 'Succeeded', 'Failed') { break }
  Start-Sleep 10
}
"account: $state"
if ($state -ne 'Succeeded') { exit 1 }

@{
  sku = @{ name = 'GlobalStandard'; capacity = 25 }
  properties = @{
    model = @{ format = 'Anthropic'; name = 'claude-sonnet-5-5'; version = '2' }
    modelProviderData = @{ organizationName = 'Tim Shields'; countryCode = 'GB'; industry = 'technology' }
    versionUpgradeOption = 'OnceNewDefaultVersionAvailable'
    raiPolicyName = 'Microsoft.DefaultV2'
  }
} | ConvertTo-Json -Depth 5 | Set-Content $tmp
"deploying claude-sonnet-5-5..."
& $az -IBm azure.cli rest --method put --url "$base/deployments/claude-sonnet-5-5`?$api" --body "@$tmp" --query "{name:name, state:properties.provisioningState}" -o json
for ($i = 0; $i -lt 60; $i++) {
  $state = & $az -IBm azure.cli rest --method get --url "$base/deployments/claude-sonnet-5-5`?$api" --query properties.provisioningState -o tsv
  if ($state -in 'Succeeded', 'Failed') { break }
  Start-Sleep 15
}
"deployment: $state"
Remove-Item $tmp
