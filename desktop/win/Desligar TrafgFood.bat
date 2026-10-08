@echo off
chcp 65001 >nul
taskkill /im TrafgFood.exe /f >nul 2>nul && echo TrafgFood desligado. || echo O TrafgFood nao estava ligado.
timeout /t 3 >nul
