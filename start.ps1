$ErrorActionPreference = "Stop"

$ScriptDir = [System.IO.Path]::GetFullPath($PSScriptRoot)
$Version = (Get-Content -LiteralPath (Join-Path $ScriptDir "VERSION") -Raw).Trim()

$Port = if ($env:PORT) { $env:PORT } else { "9090" }
$AdminKey = if ($env:ADMIN_KEY) { $env:ADMIN_KEY.Trim() } else { "" }
$DataDirValue = if ($env:DATA_DIR) { $env:DATA_DIR } else { "data" }

if ([string]::IsNullOrWhiteSpace($AdminKey) -or $AdminKey -eq "change-me" -or $AdminKey.Length -lt 16) {
    throw "ADMIN_KEY must be explicitly set to a non-default value with at least 16 characters."
}
$DataDir = if ([System.IO.Path]::IsPathRooted($DataDirValue)) {
    [System.IO.Path]::GetFullPath($DataDirValue)
} else {
    [System.IO.Path]::GetFullPath((Join-Path $ScriptDir $DataDirValue))
}

if ($env:ORRYX_JAR) {
    $Jar = if ([System.IO.Path]::IsPathRooted($env:ORRYX_JAR)) {
        [System.IO.Path]::GetFullPath($env:ORRYX_JAR)
    } else {
        [System.IO.Path]::GetFullPath((Join-Path $ScriptDir $env:ORRYX_JAR))
    }
} else {
    $Candidates = @(
        (Join-Path $ScriptDir "orryx-editor-server-$Version.jar"),
        (Join-Path $ScriptDir "server/build/libs/orryx-editor-server-$Version.jar"),
        (Join-Path $ScriptDir "orryx-editor-server-all.jar"),
        (Join-Path $ScriptDir "server/build/libs/orryx-editor-server-all.jar")
    )
    $Jar = $Candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
}

if (-not $Jar -or -not (Test-Path -LiteralPath $Jar -PathType Leaf)) {
    throw "No runnable server JAR was found. Run build.sh first or set ORRYX_JAR."
}

if ($env:JAVA_HOME) {
    $Java = Join-Path $env:JAVA_HOME "bin/java.exe"
    if (-not (Test-Path -LiteralPath $Java -PathType Leaf)) {
        throw "JAVA_HOME is invalid: $Java does not exist."
    }
} else {
    $JavaCommand = Get-Command java -ErrorAction SilentlyContinue
    if (-not $JavaCommand) {
        throw "Java was not found. Install Java 21+ or set JAVA_HOME."
    }
    $Java = $JavaCommand.Source
}

New-Item -ItemType Directory -Force -Path $DataDir | Out-Null

$env:PORT = $Port
$env:ADMIN_KEY = $AdminKey
$env:DATA_DIR = $DataDir

Write-Host "=== Orryx Editor ==="
Write-Host "  JAR:  $Jar"
Write-Host "  Port: $Port"
Write-Host "  Data: $DataDir"
Write-Host "===================="

& $Java -jar $Jar
exit $LASTEXITCODE
