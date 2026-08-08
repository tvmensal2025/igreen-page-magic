@echo off
REM Launcher local: o terminal do Cursor às vezes sobe sem o PATH do Node.
set "PATH=C:\Program Files\nodejs;%PATH%"
cd /d "%~dp0"
"C:\Program Files\nodejs\npm.cmd" run dev %*
