#!/bin/bash
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Instale o Node.js em https://nodejs.org e abra este arquivo de novo."; open https://nodejs.org; exit 1; }
[ -f .env ] || { cp .env.example .env; echo "Criei o arquivo .env. Coloque nele a sua ANTHROPIC_API_KEY e salve."; open -e .env; read -p "Depois de salvar, aperte Enter. "; }
[ -d node_modules ] || npm install --omit=dev
(sleep 2; open http://localhost:3000) &
node --env-file=.env server/index.js
