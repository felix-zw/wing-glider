#requires -Version 5.1
[CmdletBinding()]
param(
    [switch]$Edge,
    [switch]$NoBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$composeArguments = @('compose', '--project-name', 'wing-glider', '--project-directory', $repositoryRoot,
    '-f', (Join-Path $repositoryRoot 'compose.yaml'))

if ($Edge) {
    $networkJson = & docker network inspect home-edge-wing-glider
    if ($LASTEXITCODE -ne 0) {
        throw 'The home-edge-wing-glider network is missing. Initialize Home Edge first.'
    }
    $network = ($networkJson -join [Environment]::NewLine | ConvertFrom-Json)[0]
    if (-not $network.Internal -or $network.Driver -ne 'bridge' -or $network.Scope -ne 'local') {
        throw 'home-edge-wing-glider must be an internal local Docker bridge network.'
    }
    $composeArguments += @('-f', (Join-Path $repositoryRoot 'compose.edge.yaml'))
}

& docker @($composeArguments + @('config', '--quiet'))
if ($LASTEXITCODE -ne 0) { throw 'Invalid Wing Glider Compose configuration.' }

$upArguments = $composeArguments + @('up', '-d')
if (-not $NoBuild) { $upArguments += '--build' }
$upArguments += @('--wait', '--wait-timeout', '90')
& docker @upArguments
if ($LASTEXITCODE -ne 0) { throw 'Wing Glider did not start healthy.' }

& docker @($composeArguments + @('ps'))
if ($LASTEXITCODE -ne 0) { throw 'Could not read Wing Glider status.' }

if ($Edge) {
    Write-Host 'Wing Glider is ready. Cloudflare origin: http://wing-glider-origin:80'
    Write-Host 'Public URL: https://wing-glider.felixzw.de'
}
else {
    $port = if ($env:WING_GLIDER_PORT) { $env:WING_GLIDER_PORT } else { '18788' }
    Write-Host "Wing Glider is ready at http://127.0.0.1:$port"
}
