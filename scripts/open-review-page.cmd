@echo off
rem Opens the private DIBA review page through an SSH tunnel (plain OpenSSH, no PowerShell).
rem The page runs on the server only while this window stays open, listens on the server's 127.0.0.1 and is
rem never exposed to the internet. The server prints a one-time link ("Abre http://localhost:3015/?t=...");
rem Ctrl+click it. Close this window to stop the page.
rem
rem Usage:  scripts\open-review-page.cmd user@server        (or set TENSPLA_SSH_TARGET once)
if not "%~1"=="" set "TENSPLA_SSH_TARGET=%~1"
if "%TENSPLA_SSH_TARGET%"=="" (
  echo Indica el servidor: scripts\open-review-page.cmd usuario@servidor
  exit /b 1
)
set "REVIEW_PORT=3015"
echo Conectando con el servidor...
echo Cuando aparezca el enlace "Abre http://localhost:%REVIEW_PORT%/?t=...", pulsa Ctrl + clic sobre el.
echo Cierra esta ventana cuando termines: asi se apaga la pagina.
echo.
rem -tt gives the server a terminal, so the page stops when the connection drops.
ssh -tt -o ExitOnForwardFailure=yes -L %REVIEW_PORT%:127.0.0.1:%REVIEW_PORT% %TENSPLA_SSH_TARGET% "export NVM_DIR=/root/.nvm; . $NVM_DIR/nvm.sh >/dev/null 2>&1; cd /var/www/queFem && REVIEW_PORT=%REVIEW_PORT% exec npm run --silent review:serve"
