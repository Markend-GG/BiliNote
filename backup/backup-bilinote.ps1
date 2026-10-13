# BiliNote volume backup script (Windows PowerShell). Keep ASCII-only: PS 5.1 reads BOM-less files as ANSI.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File backup-bilinote.ps1
#
# Spins a one-shot container mounting the 6 named volumes read-only plus the backup dir
# writable, and tars with the tar shipped in the bilinote image (no extra pull, no host tar).
# The running container is untouched; BiliNote keeps serving during backup.
# For a strictly consistent snapshot stop the container first.
#
# Retention: keep the newest 5 archives.
$ErrorActionPreference = 'Stop'

$backupRoot = 'G:\work\BiliNote\backups'
$runnerImage = 'bilinote-gpu:local'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$archive = "bilinote-$stamp.tar.gz"

New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null

Write-Host "Backing up 6 volumes -> $backupRoot\$archive"
docker run --rm --entrypoint tar `
  -v bilinote-cache:/ro/cache:ro `
  -v bilinote-config:/ro/config:ro `
  -v bilinote-data:/ro/data:ro `
  -v bilinote-models:/ro/models:ro `
  -v bilinote-static:/ro/static:ro `
  -v bilinote-vector:/ro/vector:ro `
  -v "${backupRoot}:/out" `
  $runnerImage -czf "/out/$archive" -C /ro cache config data models static vector

if ($LASTEXITCODE -ne 0) { throw "tar exited with $LASTEXITCODE" }

$size = [math]::Round((Get-Item (Join-Path $backupRoot $archive)).Length / 1MB, 1)
Write-Host "Backup done: $archive (${size} MB)"

# keep newest 5
Get-ChildItem $backupRoot -Filter 'bilinote-*.tar.gz' |
  Sort-Object LastWriteTime -Descending |
  Select-Object -Skip 5 |
  ForEach-Object {
    Write-Host "Pruning old backup: $($_.Name)"
    Remove-Item $_.FullName -Force
  }

# Optional weekly schedule (run once in an elevated PowerShell):
#   schtasks /Create /TN "BiliNoteBackup" /SC WEEKLY /D SAT /ST 09:00 `
#     /TR "powershell -ExecutionPolicy Bypass -File G:\work\BiliNote\bilinote-src\backup\backup-bilinote.ps1"
