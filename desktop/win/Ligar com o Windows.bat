@echo off
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ligar-com-windows.ps1"
wscript.exe "%~dp0Abrir TrafgFood.vbs"
echo.
echo Pronto. O TrafgFood agora liga sozinho quando o computador ligar,
echo e tem um atalho TrafgFood na area de trabalho para abrir.
echo Nao mude esta pasta de lugar. Se mudar, rode este arquivo de novo.
echo.
pause
