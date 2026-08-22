# scripts/watch-toolchain-and-install.ps1 — wait for BITS download, then auto-install esp32 core
$dest = "C:\Users\蔡\AppData\Local\Arduino15\staging\packages"
$file = "riscv32-esp-elf-14.2.0_20260121-x86_64-w64-mingw32.zip"

while ($true) {
  $jobs = Get-BitsTransfer -ErrorAction SilentlyContinue
  $j = $jobs | Where-Object { $_.JobState -ne 'Error' } | Select-Object -First 1
  if (-not $j) {
    Write-Output "NO ACTIVE BITS JOB - check download manually"
    exit 1
  }
  $mb = [math]::Round($j.BytesTransferred / 1MB, 1)
  if ($j.BytesTotal -gt 1TB) { $total = "?" } else { $total = [math]::Round($j.BytesTotal / 1MB, 0) }
  Write-Output ("downloading: " + $mb + " MB / " + $total + " MB  (" + $j.JobState + ")")
  if ($j.JobState -eq 'Transferred') {
    Complete-BitsTransfer -BitsJob $j
    Write-Output "toolchain downloaded, running esp32 core install..."
    & powershell -ExecutionPolicy Bypass -File "E:\AI related\find-my-glasses-pro\scripts\setup-esp32-core.ps1" -CliExe "C:\Program Files\Arduino CLI\arduino-cli.exe"
    exit 0
  }
  Start-Sleep -Seconds 120
}
