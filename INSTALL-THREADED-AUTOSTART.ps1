$ErrorActionPreference = 'Stop'
$projectDir = (Resolve-Path $PSScriptRoot).Path
$bundledNode = Join-Path $projectDir 'runtime/node.exe'
$nodePath = if (Test-Path -LiteralPath $bundledNode) { $bundledNode } else { (Get-Command node -ErrorAction Stop).Source }
Push-Location $projectDir
try {
    & $nodePath -e "const fs=require('fs');if(fs.existsSync('.env.threads'))process.loadEnvFile('.env.threads');if(!process.env.THREAD_DISCORD_BOT_TOKEN||!process.env.THREAD_DISCORD_APPLICATION_ID)throw new Error('Finish .env.threads first.');import('discord.js');"
    if ($LASTEXITCODE -ne 0) { throw 'Thread bot setup is incomplete.' }
} finally { Pop-Location }
$account = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction -Execute (Get-Command powershell.exe).Source -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -File "' + (Join-Path $projectDir 'scripts/run-thread-service.ps1') + '"') -WorkingDirectory $projectDir
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $account
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 20 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId $account -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName 'Canadian Chemical Eng Journal Threads Bot' -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Discord journal bot with one public thread per issue and one article per message.' -Force | Out-Null
Start-ScheduledTask -TaskName 'Canadian Chemical Eng Journal Threads Bot'
Write-Output 'Thread bot started. It will run hidden at login and scan every 24 hours while this computer is available.'
