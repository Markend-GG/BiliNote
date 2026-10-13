# BiliNote 数据卷备份脚本（Windows PowerShell）
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File backup-bilinote.ps1
#
# 原理：起一个一次性容器，把 6 个命名卷以只读方式挂进去、备份目录挂成可写，
# 用 bilinote 镜像自带的 tar 打包（不额外拉镜像、不依赖宿主机 tar）。
# 容器本身不被触碰，备份期间 BiliNote 可以照常运行（SQLite 为 WAL/短事务，
# 极端情况下可能拿到某一瞬间的不一致快照，可接受；要绝对一致请先 stop 容器）。
#
# 保留策略：最近 5 份。
$ErrorActionPreference = 'Stop'

$backupRoot = 'G:\work\BiliNote\backups'
$runnerImage = 'bilinote-gpu:local'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$archive = "bilinote-$stamp.tar.gz"

New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null

Write-Host "开始备份 6 个数据卷 -> $backupRoot\$archive"
docker run --rm --entrypoint tar `
  -v bilinote-cache:/ro/cache:ro `
  -v bilinote-config:/ro/config:ro `
  -v bilinote-data:/ro/data:ro `
  -v bilinote-models:/ro/models:ro `
  -v bilinote-static:/ro/static:ro `
  -v bilinote-vector:/ro/vector:ro `
  -v "${backupRoot}:/out" `
  $runnerImage -czf "/out/$archive" -C /ro cache config data models static vector

if ($LASTEXITCODE -ne 0) { throw "tar 退出码 $LASTEXITCODE，备份失败" }

$size = [math]::Round((Get-Item (Join-Path $backupRoot $archive)).Length / 1MB, 1)
Write-Host "备份完成：$archive（${size} MB）"

# 只留最近 5 份
Get-ChildItem $backupRoot -Filter 'bilinote-*.tar.gz' |
  Sort-Object LastWriteTime -Descending |
  Select-Object -Skip 5 |
  ForEach-Object {
    Write-Host "清理旧备份：$($_.Name)"
    Remove-Item $_.FullName -Force
  }

# 想每周自动跑（管理员 PowerShell 里执行一次即可）：
#   schtasks /Create /TN "BiliNoteBackup" /SC WEEKLY /D SAT /ST 09:00 `
#     /TR "powershell -ExecutionPolicy Bypass -File G:\work\BiliNote\bilinote-src\backup\backup-bilinote.ps1"
