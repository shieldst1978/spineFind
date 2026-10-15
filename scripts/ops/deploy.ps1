# Deploys the current git HEAD of SpineFind: waits for its GHCR image, switches the app to it, waits until healthy.
$az = 'C:\Program Files (x86)\Microsoft SDKs\Azure\CLI2\python.exe'
Set-Location (Resolve-Path "$PSScriptRoot\..\..")
$sha = git rev-parse HEAD
$image = "ghcr.io/shieldst1978/spinefind:$sha"

$token = ((Get-Content .env.local | Where-Object { $_ -like 'GHCR_READ_TOKEN=*' }) -replace '^GHCR_READ_TOKEN=', '').Trim()
$basic = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("shieldst1978:$token"))
$ready = $false
for ($i = 0; $i -lt 40 -and -not $ready; $i++) {
  try {
    $bearer = (Invoke-RestMethod "https://ghcr.io/token?scope=repository:shieldst1978/spinefind:pull&service=ghcr.io" -Headers @{ Authorization = "Basic $basic" }).token
    $r = Invoke-WebRequest "https://ghcr.io/v2/shieldst1978/spinefind/manifests/$sha" -Method Head -UseBasicParsing -SkipHttpErrorCheck `
      -Headers @{ Authorization = "Bearer $bearer"; Accept = 'application/vnd.oci.image.index.v1+json,application/vnd.docker.distribution.manifest.v2+json' }
    if ($r.StatusCode -eq 200) { $ready = $true; break }
  } catch {}
  Start-Sleep 15
}
$token = $null; $basic = $null
if (-not $ready) { "Image $image not found after 10 minutes; check GitHub Actions."; exit 1 }
"image ready: $image"

& $az -IBm azure.cli containerapp update --name spinefind --resource-group SpineFind --image $image --only-show-errors --output none
$rev = & $az -IBm azure.cli containerapp show --name spinefind --resource-group SpineFind --query properties.latestRevisionName -o tsv
for ($i = 0; $i -lt 30; $i++) {
  $health = & $az -IBm azure.cli containerapp revision show --name spinefind --resource-group SpineFind --revision $rev --query properties.healthState -o tsv
  if ($health -in 'Healthy', 'Unhealthy') { break }
  Start-Sleep 10
}
"revision $rev : $health"
& $az -IBm azure.cli containerapp revision list --name spinefind --resource-group SpineFind --query "[?properties.active].{name:name, health:properties.healthState, traffic:properties.trafficWeight}" -o table
& $az -IBm azure.cli containerapp show --name spinefind --resource-group SpineFind --query "properties.template.scale.rules[].name" -o tsv
