# scripts/spatiallm/wsl-install.ps1 — 本机 WSL2 + Ubuntu 一键安装（必须管理员运行）
# 用法：右键「使用 PowerShell 以管理员身份运行」，或管理员 PowerShell 里：
#   powershell -ExecutionPolicy Bypass -File scripts\spatiallm\wsl-install.ps1
# 装完按提示重启电脑，然后继续 docs/SPATIALLM_ENV.md 第 5 节（运行 setup.sh）。
# 背景：docs/SPATIALLM_ENV.md §2；本机实测 RTX 5070 Laptop 8GB / 31GB / Hypervisor 已启用。
$ErrorActionPreference = 'Stop'

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Host "❌ 请以管理员身份运行本脚本（右键 → 以管理员身份运行）" -ForegroundColor Red
  exit 1
}

# 全程日志 + 完成标记（供非交互调用方轮询）
Start-Transcript -Path "$env:TEMP\wsl-install.log" -Force | Out-Null
Remove-Item "$env:TEMP\wsl-install.done" -Force -ErrorAction SilentlyContinue

Write-Host "==== 1/3 启用 Windows 功能（WSL + 虚拟机平台）===="
Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux -All -NoRestart | Out-Null
Enable-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform -All -NoRestart | Out-Null
Write-Host "✅ 功能已启用"

Write-Host "==== 2/3 写入 .wslconfig（内存 12GB / 交换 8GB / 8 核）===="
@"
[wsl2]
memory=12GB
swap=8GB
processors=8
"@ | Set-Content "$env:USERPROFILE\.wslconfig" -Encoding ascii
Write-Host "✅ $env:USERPROFILE\.wslconfig"

Write-Host "==== 3/3 安装 WSL + Ubuntu 发行版 ===="
Write-Host "（下载约 1-2 分钟；先走商店源，失败自动改用 web 源）"
wsl.exe --install -d Ubuntu --no-launch
if ($LASTEXITCODE -ne 0) {
  Write-Host "⚠️ 商店源失败，改用 --web-download 重试…" -ForegroundColor Yellow
  wsl.exe --install -d Ubuntu --no-launch --web-download
}
if ($LASTEXITCODE -ne 0) {
  Write-Host "❌ WSL 安装失败（错误码 $LASTEXITCODE）。检查网络或手动执行：wsl --install -d Ubuntu --web-download" -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "✅ 安装完成。下一步：重启电脑，然后："
Write-Host "   1) 启动 Ubuntu，按提示设置 Linux 用户名密码（记好）"
Write-Host "   2) 验证 GPU 直通：wsl -d Ubuntu -- nvidia-smi"
Write-Host "   3) 运行环境脚本：wsl.exe -d Ubuntu -u root -- bash //mnt/c/<仓库路径>/scripts/spatiallm/setup.sh"
Write-Host "      （Git Bash 里注意 // 双斜杠；或用第 2 步 cp 方式，见 docs/SPATIALLM_ENV.md 第 5 节）"
Set-Content "$env:TEMP\wsl-install.done" -Value "done at $(Get-Date) exit=$LASTEXITCODE" -Encoding ascii
Stop-Transcript | Out-Null
Read-Host "按回车退出"
