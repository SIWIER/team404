# scripts/setup-esp32-core.ps1 — install ESP32 board package (with retries for flaky networks)
# Usage: powershell -ExecutionPolicy Bypass -File scripts\setup-esp32-core.ps1 -CliExe "C:\Program Files\Arduino CLI\arduino-cli.exe"
param(
  [string]$CliExe = "arduino-cli"
)

Write-Output "=== 1) init arduino-cli config (China mirror) ==="
& $CliExe config init --overwrite 2>&1 | Out-Null
& $CliExe config add board_manager.additional_urls https://gitee.com/linux-rm/package_esp32_dev_index.json/raw/master/package_esp32_dev_index.json

Write-Output "=== 2) update board index ==="
for ($i = 1; $i -le 3; $i++) {
  & $CliExe core update-index 2>&1 | Select-Object -Last 2
  if ($LASTEXITCODE -eq 0) { break }
  Write-Output "index update failed, retry in 15s ($i/3)..."
  Start-Sleep -Seconds 15
}

Write-Output "=== 3) install esp32 core (large file, up to 4 retries) ==="
for ($i = 1; $i -le 4; $i++) {
  Write-Output "--- attempt $i ---"
  & $CliExe core install esp32:esp32
  if ($LASTEXITCODE -eq 0) {
    Write-Output "OK: esp32 core installed!"
    & $CliExe core list
    Write-Output "=== ESP32C3 boards available ==="
    & $CliExe board listall | Select-String -Pattern "esp32.*esp32c3" | Select-Object -First 5
    exit 0
  }
  Write-Output "failed, retry in 30s..."
  Start-Sleep -Seconds 30
}
Write-Output "FAILED after retries, please rerun this script later"
exit 1
