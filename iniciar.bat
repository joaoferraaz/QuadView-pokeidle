@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Instale o Node.js LTS em https://nodejs.org e rode de novo. & pause & exit /b 1)
if not exist node_modules (echo Instalando dependencias, so na primeira vez... & call npm install --no-audit --no-fund)
call npm start
