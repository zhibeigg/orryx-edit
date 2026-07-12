$ErrorActionPreference = "Stop"
$ScriptDir = [System.IO.Path]::GetFullPath($PSScriptRoot)
$Version = (Get-Content -LiteralPath (Join-Path $ScriptDir "VERSION") -Raw).Trim()
$Port = if ($env:PORT) { $env:PORT } else { "9090" }
$AdminKey = if ($env:ADMIN_KEY) { $env:ADMIN_KEY.Trim() } else { "" }
$DataDirValue = if ($env:DATA_DIR) { $env:DATA_DIR } else { "data" }
$DeploymentMode = if ($env:DEPLOYMENT_MODE) { $env:DEPLOYMENT_MODE } else { "source" }

if ([string]::IsNullOrWhiteSpace($AdminKey) -or $AdminKey -eq "change-me" -or $AdminKey.Length -lt 16) {
    throw "ADMIN_KEY must be explicitly set to a non-default value with at least 16 characters."
}
$DataDir = if ([System.IO.Path]::IsPathRooted($DataDirValue)) { [System.IO.Path]::GetFullPath($DataDirValue) } else { [System.IO.Path]::GetFullPath((Join-Path $ScriptDir $DataDirValue)) }
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
$UpdateDir = if ($env:UPDATE_STAGING_DIR) { [System.IO.Path]::GetFullPath($env:UPDATE_STAGING_DIR) } else { Join-Path $DataDir "updates" }

if ($env:ORRYX_JAR) {
    $Jar = if ([System.IO.Path]::IsPathRooted($env:ORRYX_JAR)) { [System.IO.Path]::GetFullPath($env:ORRYX_JAR) } else { [System.IO.Path]::GetFullPath((Join-Path $ScriptDir $env:ORRYX_JAR)) }
} else {
    $Jar = @((Join-Path $ScriptDir "orryx-editor-server-$Version.jar"), (Join-Path $ScriptDir "server/build/libs/orryx-editor-server-$Version.jar")) |
        Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
}
if (-not $Jar -or -not (Test-Path -LiteralPath $Jar -PathType Leaf)) { throw "No runnable server JAR was found." }
$Java = if ($env:JAVA_HOME) { Join-Path $env:JAVA_HOME "bin/java.exe" } else { (Get-Command java -ErrorAction Stop).Source }

$env:PORT = $Port; $env:ADMIN_KEY = $AdminKey; $env:DATA_DIR = $DataDir
$env:DEPLOYMENT_MODE = $DeploymentMode; $env:ORRYX_LAUNCHER_MANAGED = "true"

function Apply-PendingUpdate {
    $result = @{ Applied = $false; Backup = $null; Version = $null }
    if ($DeploymentMode -ne "launcher") { return $result }
    $manifestPath = Join-Path $UpdateDir "pending-update.properties"
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { return $result }
    $values = @{}
    foreach ($line in Get-Content -LiteralPath $manifestPath) {
        $parts = $line -split "=", 2
        if ($parts.Count -eq 2) { $values[$parts[0]] = $parts[1].Trim() }
    }
    $targetVersion = $values["version"]; $artifact = $values["artifact"]; $expected = $values["sha256"]
    if ($targetVersion -notmatch '^\d+\.\d+\.\d+$') { throw "Invalid pending version." }
    if ($artifact -ne "orryx-editor-$targetVersion.jar") { throw "Invalid pending artifact." }
    if ($expected -notmatch '^[a-f0-9]{64}$') { throw "Invalid pending checksum." }
    $staged = Join-Path (Join-Path $UpdateDir "staged") $artifact
    if (-not (Test-Path -LiteralPath $staged -PathType Leaf)) { throw "Staged JAR does not exist." }
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $staged).Hash.ToLowerInvariant()
    if ($actual -ne $expected) { throw "Staged JAR checksum mismatch." }
    $backupDir = Join-Path $UpdateDir "backups"; New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
    $backup = Join-Path $backupDir "orryx-editor-$Version.jar"
    Copy-Item -LiteralPath $Jar -Destination $backup -Force
    [System.IO.File]::Move($staged, $Jar, $true)
    Remove-Item -LiteralPath $manifestPath -Force
    $jsonManifest = Join-Path $UpdateDir "pending-update.json"
    if (Test-Path -LiteralPath $jsonManifest) { Remove-Item -LiteralPath $jsonManifest -Force }
    return @{ Applied = $true; Backup = $backup; Version = $targetVersion }
}

while ($true) {
    $applied = Apply-PendingUpdate
    Write-Host "=== Orryx Editor ===`n  JAR: $Jar`n  Port: $Port`n  Data: $DataDir`n===================="
    $process = Start-Process -FilePath $Java -ArgumentList @("-jar", $Jar) -PassThru -NoNewWindow

    if ($applied.Applied) {
        $healthy = $false
        for ($attempt = 0; $attempt -lt 30 -and -not $process.HasExited; $attempt++) {
            try {
                $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health/ready" -TimeoutSec 2
                if ($health.status -eq "UP" -and $health.version -eq $applied.Version) { $healthy = $true; break }
            } catch { }
            Start-Sleep -Seconds 2
        }
        if (-not $healthy) {
            Write-Warning "New version failed health check; rolling back."
            if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force }
            $process.WaitForExit()
            [System.IO.File]::Move($applied.Backup, $Jar, $true)
            $process = Start-Process -FilePath $Java -ArgumentList @("-jar", $Jar) -PassThru -NoNewWindow
        }
    }

    $process.WaitForExit()
    if ($process.ExitCode -ne 42) { exit $process.ExitCode }
}
