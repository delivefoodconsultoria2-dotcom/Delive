@echo off
chcp 65001 >nul
title TrafgFood
cd /d "%~dp0"
where node >nul 2>nul || (echo Instale o Node.js em https://nodejs.org e abra este arquivo de novo. & start https://nodejs.org & pause & exit /b)
if not exist .env (copy .env.example .env >nul & echo Criei o arquivo .env. Coloque nele a sua ANTHROPIC_API_KEY e salve. & notepad .env)
if not exist node_modules (echo Instalando, so na primeira vez... & call npm install --omit=dev)
start "" http://localhost:3000
node --env-file=.env server/index.js
pause
