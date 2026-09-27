# Fetch the optional, pinned Basis Universal WASI encoder into the repository.
# This does not install software globally or change PATH. Node runs the encoder.
$ErrorActionPreference = 'Stop'
$artRepository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$artToolDirectory = Join-Path $artRepository 'tmp/art-tools'
$artEncoder = Join-Path $artToolDirectory 'basisu_st.wasm'
$artRevision = '1aab02ba2df16ad873229030ea191ea8c10e3fc9'
$artSha256 = '7B8837E020E48239AB3085697A16334649C07EF121F5A6556D8B17919938A143'
$artSource = "https://raw.githubusercontent.com/BinomialLLC/basis_universal/$artRevision/bin/basisu_st.wasm"

if (Test-Path -LiteralPath $artEncoder) {
    if ((Get-FileHash -LiteralPath $artEncoder -Algorithm SHA256).Hash -ne $artSha256) {
        throw "The existing encoder has an unexpected hash. Inspect $artEncoder before replacing it."
    }
    Write-Output "Verified existing Basis Universal encoder: $artEncoder"
    exit 0
}

New-Item -ItemType Directory -Path $artToolDirectory -Force | Out-Null
$artDownload = Join-Path $artToolDirectory 'basisu_st.wasm.download'
Invoke-WebRequest -Uri $artSource -OutFile $artDownload
if ((Get-FileHash -LiteralPath $artDownload -Algorithm SHA256).Hash -ne $artSha256) {
    throw "Downloaded encoder did not match the pinned SHA-256. It was retained at $artDownload for inspection."
}
Move-Item -LiteralPath $artDownload -Destination $artEncoder
Write-Output "Downloaded and verified Basis Universal $artRevision to $artEncoder"
