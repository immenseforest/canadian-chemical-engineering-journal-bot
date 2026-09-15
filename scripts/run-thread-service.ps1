$ErrorActionPreference = 'Stop'
$projectDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $projectDir
$bundledNode = Join-Path $projectDir 'runtime/node.exe'
$nodePath = if (Test-Path -LiteralPath $bundledNode) { $bundledNode } else { (Get-Command node -ErrorAction Stop).Source }
& $nodePath 'scripts/run-thread-service.mjs'
exit $LASTEXITCODE
