param(
    [switch]$CheckOnly,
    [switch]$CaptureOnly,
    [switch]$InspectAcp
)
$ErrorActionPreference = "Stop"
$toolDir = $PSScriptRoot
$repoRoot = (Resolve-Path (Join-Path $toolDir "..\..")).Path
Push-Location $repoRoot
try {
    Write-Host ""
    Write-Host "============================================="
    Write-Host " CASCADE | AUTOMATED JUDGE DEMO STUDIO"
    Write-Host "============================================="
    Write-Host "This captures only EXISTING local evidence. No Mattermost posts are created."
    Write-Host ""

    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        throw "Node.js 20+ is missing. Install Node.js 22 LTS from nodejs.org."
    }
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        throw "npm is missing. Install Node.js with npm from nodejs.org."
    }
    $major = [int]((node --version).Trim().TrimStart("v").Split(".")[0])
    if ($major -lt 20) {
        throw "Node.js 20+ is required; found version $(node --version)."
    }

    if (-not (Test-Path "node_modules\typescript")) {
        Write-Host "[Setup] Installing core engine dependencies..."
        & npm.cmd install --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw "Core npm install failed." }
    }
    Write-Host "[Setup] Building deterministic CASCADE engine..."
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw "TypeScript build failed." }

    if (-not (Test-Path "tools\demo-studio\node_modules\playwright")) {
        Write-Host "[Setup] Installing isolated recorder dependencies..."
        & npm.cmd install --prefix "tools\demo-studio" --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw "Recorder npm install failed." }
    }
    if (-not $CheckOnly -and -not $InspectAcp) {
        Write-Host "[Setup] Ensuring dedicated Chromium browser is installed..."
        Push-Location (Join-Path $repoRoot "tools\demo-studio")
        try {
            & npx.cmd playwright install chromium
            if ($LASTEXITCODE -ne 0) { throw "Playwright Chromium installation failed." }
        } finally { Pop-Location }
    }

    $arguments = @("tools\demo-studio\record.mjs")
    if ($CheckOnly) { $arguments += "--check-only" }
    if ($CaptureOnly) { $arguments += "--capture-only" }
    if ($InspectAcp) { $arguments += "--inspect-acp" }
    & node @arguments
    if ($LASTEXITCODE -ne 0) { throw "Recorder stopped because evidence was unavailable or rendering failed." }

    Write-Host ""
    if (-not $CheckOnly -and -not $CaptureOnly -and -not $InspectAcp) {
        $outputFile = Join-Path $repoRoot "demo-output\CASCADE_FlipTheSwitch_Demo_V2.mp4"
        Write-Host "SUCCESS! MP4 saved to:"
        Write-Host $outputFile
        Write-Host "REVIEW THE VIDEO before publicly sharing it."
        if (Test-Path $outputFile) { Start-Process -FilePath $outputFile }
    }
} catch {
    Write-Host ""
    Write-Host ("CASCADE Studio stopped safely: " + $_.Exception.Message) -ForegroundColor Red
    exit 1
} finally {
    Pop-Location
}
