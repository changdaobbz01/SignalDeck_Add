$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

Set-Location $PSScriptRoot

function Resolve-BasePython {
  if (Test-Path ".venv-package\\Scripts\\python.exe") {
    return (Join-Path $PSScriptRoot ".venv-package\\Scripts\\python.exe")
  }

  try {
    $result = (& py -3 -c "import sys; print(sys.executable)").Trim()
    if ($result) {
      return $result
    }
  }
  catch {
  }

  try {
    $result = (& python -c "import sys; print(sys.executable)").Trim()
    if ($result) {
      return $result
    }
  }
  catch {
  }

  throw "Python 3 was not found. Install Python 3 or ensure 'py -3' or 'python' is available in PATH."
}

if (-not (Test-Path ".venv-package\\Scripts\\python.exe")) {
  $basePython = Resolve-BasePython
  & $basePython -m venv .venv-package
}

$python = Join-Path $PSScriptRoot ".venv-package\\Scripts\\python.exe"
& $python -m pip install --upgrade pip
& $python -m pip install -r requirements.txt pyinstaller

Remove-Item -Recurse -Force build, dist -ErrorAction SilentlyContinue
& $python -m PyInstaller --clean --noconfirm SignalDeck.spec

$artifactDir = Join-Path $PSScriptRoot "artifacts"
New-Item -ItemType Directory -Force -Path $artifactDir | Out-Null
$zipPath = Join-Path $artifactDir "SignalDeck-windows.zip"
Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
Compress-Archive -Path (Join-Path $PSScriptRoot "dist\\SignalDeck\\*") -DestinationPath $zipPath
Write-Host "Windows package created:" $zipPath
