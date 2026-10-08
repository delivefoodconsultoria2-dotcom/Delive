@echo off
chcp 65001 >nul
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\TrafgFood.lnk" >nul 2>nul
echo O TrafgFood nao vai mais ligar sozinho com o Windows.
echo O atalho da area de trabalho continua funcionando.
pause
