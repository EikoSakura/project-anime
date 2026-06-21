<#
  build.ps1 - Build a Forge/Foundry-correct project-anime.zip from this repo.

  Produces <repo>/project-anime.zip containing ONLY real system content, with
  forward-slash entry paths, then validates it against system.json.

  WHY the ZipArchive API (not Compress-Archive / ZipFile.CreateFromDirectory):
  on Windows PowerShell 5.1 both of those write BACKSLASH path separators inside
  the zip. Forge runs on Linux, which then reads "module\project-anime.mjs" as a
  single flat filename - so module/, templates/, etc. "don't exist" and the world
  fails to launch. CreateEntryFromFile with explicit forward-slash names avoids it.

  Usage:  powershell -ExecutionPolicy Bypass -File tools/build.ps1
#>
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot          # repo root (this script lives in tools/)
$out  = Join-Path $root "project-anime.zip"

# Allowlist of real system content. Anything NOT listed is excluded by design:
# .git, the stray project-anime/ clone, the dead styles/ folder, mockups/, dev
# docs (HQ-REDESIGN/VERIFY/*.pdf), the .zip itself, etc.
$dirs  = @("module","css","lang","templates","packs","fonts","icons","assets")
$files = @("system.json","README.md","CHANGELOG.md")

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

if (Test-Path $out) { [System.IO.File]::Delete($out) }
$fs  = [System.IO.File]::Open($out, [System.IO.FileMode]::Create)
$zip = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Create)
$base = (Resolve-Path $root).Path.TrimEnd('\') + '\'
$lvl  = [System.IO.Compression.CompressionLevel]::Optimal
$count = 0
function Add-Entry($full, $entry) {
  [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($script:zip, $full, $entry, $script:lvl)
  $script:count++
}
foreach ($f in $files) { $p = Join-Path $root $f; if (Test-Path $p) { Add-Entry $p $f } }
foreach ($d in $dirs) {
  $dp = Join-Path $root $d
  if (-not (Test-Path $dp)) { continue }
  # Skip LevelDB LOCK files a running Foundry may hold; everything else ships.
  foreach ($file in (Get-ChildItem $dp -Recurse -File | Where-Object { $_.Name -ne 'LOCK' })) {
    Add-Entry $file.FullName ($file.FullName.Substring($base.Length).Replace('\','/'))
  }
}
$zip.Dispose(); $fs.Dispose()

# ---- validate the artifact the way Foundry/Forge will read it ----
$zip   = [System.IO.Compression.ZipFile]::OpenRead($out)
$names = $zip.Entries.FullName
$set   = [System.Collections.Generic.HashSet[string]]::new(); $names | ForEach-Object { [void]$set.Add($_) }
$sjE   = $zip.Entries | Where-Object { $_.FullName -eq "system.json" } | Select-Object -First 1
$r = New-Object System.IO.StreamReader($sjE.Open()); $sj = $r.ReadToEnd() | ConvertFrom-Json; $r.Close()
$problems = @()
$bs = @($names | Where-Object { $_ -match '\\' }).Count
if ($bs -gt 0) { $problems += "$bs entries use backslash separators (would break on Forge/Linux)" }
foreach ($ref in (@($sj.esmodules) + @($sj.styles) + @($sj.languages.path))) {
  if ($ref -and -not $set.Contains($ref)) { $problems += "missing file referenced by system.json: $ref" }
}
foreach ($p in $sj.packs) {
  if (@($names | Where-Object { $_ -like ($p.path.TrimEnd('/') + "/*") }).Count -lt 1) { $problems += "empty/missing pack: $($p.path)" }
}
$zip.Dispose()

$kb = [math]::Round((Get-Item $out).Length / 1KB)
if ($problems.Count) {
  Write-Host "BUILD FAILED VALIDATION:" -ForegroundColor Red
  $problems | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
  exit 1
}
Write-Host ("OK  project-anime.zip  v{0}  {1} files  {2} KB  (forward-slash, validated)" -f $sj.version, $count, $kb) -ForegroundColor Green
