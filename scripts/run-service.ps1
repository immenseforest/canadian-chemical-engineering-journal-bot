$ErrorActionPreference = 'Stop'
$projectDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $projectDir
$bundledNode = Join-Path $projectDir 'runtime/node.exe'
$nodePath = if (Test-Path -LiteralPath $bundledNode) { $bundledNode } else { (Get-Command node -ErrorAction Stop).Source }
$logDir = Join-Path $projectDir 'data/installable'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$logFile = Join-Path $logDir 'service.log'
if ((Test-Path -LiteralPath $logFile) -and (Get-Item -LiteralPath $logFile).Length -gt 2097152) {
    Move-Item -LiteralPath $logFile -Destination ($logFile + '.previous') -Force
}
& $nodePath 'scripts/run-service.mjs'
exit $LASTEXITCODE
