param([string]$TaskName = 'Canadian Chemical Eng Journal Bot')
$ErrorActionPreference = 'Stop'
$projectDir = (Resolve-Path $PSScriptRoot).Path
$nodePath = (Get-Command node -ErrorAction Stop).Source
Push-Location $projectDir
try {
    & $nodePath -e "const fs=require('fs');for(const p of ['.env','.env.hub'])if(fs.existsSync(p))process.loadEnvFile(p);if(!process.env.HUB_DISCORD_BOT_TOKEN&&!process.env.DISCORD_BOT_TOKEN)throw new Error('Configure the Discord bot token first.');import('discord.js');"
    if ($LASTEXITCODE -ne 0) { throw 'Hub setup is incomplete.' }
} finally { Pop-Location }
$account = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction -Execute (Get-Command powershell.exe).Source -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -File "' + (Join-Path $projectDir 'scripts/run-hub-service.ps1') + '"') -WorkingDirectory $projectDir
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $account
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 20 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId $account -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Research Journal Hub: opt-in journal subscriptions and issue threads.' -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName
Write-Output 'Journal hub started. Use /journals help in Discord.'
