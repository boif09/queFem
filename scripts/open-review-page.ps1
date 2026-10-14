<#
  Opens the private DIBA review page through an SSH tunnel.

  The page runs on the server for as long as this window stays open, listens only on the server's
  127.0.0.1 and is never exposed to the internet. Close the window (or press Ctrl+C) to stop it.

  Usage:
    powershell -ExecutionPolicy Bypass -File scripts/open-review-page.ps1 -Target root@your-server
  or set the TENSPLA_SSH_TARGET environment variable once and run it without arguments.
#>
param(
  [string]$Target = $env:TENSPLA_SSH_TARGET,
  [int]$Port = 3015,
  [string]$AppDirectory = '/var/www/queFem'
)

if (-not $Target) { throw 'Indica el servidor con -Target usuario@servidor o define TENSPLA_SSH_TARGET.' }
if ($Port -lt 1024 -or $Port -gt 65535) { throw 'El puerto debe estar entre 1024 y 65535.' }
if ($AppDirectory -notmatch '^/[A-Za-z0-9/_.-]+$') { throw 'AppDirectory solo admite una ruta absoluta sencilla.' }

# A fresh secret per launch: it is sent to the server over SSH and put in the URL opened locally, never over the internet.
$bytes = New-Object byte[] 24
$random = New-Object System.Security.Cryptography.RNGCryptoServiceProvider
$random.GetBytes($bytes)
$random.Dispose()
$token = -join ($bytes | ForEach-Object { $_.ToString('x2') })
# The secret never appears in a process command line: it is written to a private file over stdin and read (then
# deleted) by the server's start command. Only hexadecimal characters are kept: Windows PowerShell 5.1 adds a BOM and
# a CRLF to piped text.
$tokenFile = '.tenspla-review-token'
$token | ssh $Target "umask 077; cat > $tokenFile"
if ($LASTEXITCODE -ne 0) { throw 'No se pudo preparar la sesión en el servidor.' }
$remote = "export NVM_DIR=/root/.nvm; . `$NVM_DIR/nvm.sh >/dev/null 2>&1; cd $AppDirectory && export REVIEW_TOKEN=`$(tr -dc '0-9a-f' < ~/$tokenFile); rm -f ~/$tokenFile; REVIEW_PORT=$Port exec npm run --silent review:serve"
Start-Job -ScriptBlock { param($p, $t) Start-Sleep -Seconds 4; Start-Process "http://localhost:$p/?t=$t" } -ArgumentList $Port, $token | Out-Null
Write-Host "Abriendo la página de revisión en http://localhost:$Port ... (cierra esta ventana para detenerla)"
# -tt forces a remote terminal so the server stops when the connection drops.
ssh -tt -o ExitOnForwardFailure=yes -L "${Port}:127.0.0.1:${Port}" $Target $remote
