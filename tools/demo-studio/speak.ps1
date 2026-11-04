param(
    [Parameter(Mandatory=$true)][string]$TextFile,
    [Parameter(Mandatory=$true)][string]$OutputFile
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Speech
$text = [System.IO.File]::ReadAllText($TextFile, [System.Text.Encoding]::UTF8)
if ([string]::IsNullOrWhiteSpace($text)) {
    throw "Narration text was empty."
}
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $voiceName = [Environment]::GetEnvironmentVariable("CASCADE_DEMO_VOICE")
    if (-not [string]::IsNullOrWhiteSpace($voiceName)) {
        $synth.SelectVoice($voiceName)
    }
    $synth.Rate = 0
    $synth.Volume = 100
    $synth.SetOutputToWaveFile($OutputFile)
    $synth.Speak($text)
}
finally {
    $synth.Dispose()
}
if (-not (Test-Path -LiteralPath $OutputFile)) {
    throw "Windows speech synthesis did not produce the expected WAV file."
}
