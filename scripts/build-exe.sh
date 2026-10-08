#!/usr/bin/env bash
# Gera dist/TrafgFood-Windows.zip com TrafgFood.exe (Node SEA) + telas + base de conhecimento.
# Precisa do mesmo Node da versão abaixo instalado na máquina que gera o .exe.
set -euo pipefail
cd "$(dirname "$0")/.."
NODE_V="${NODE_V:-$(node -v)}"
WORK="build/win"; OUT="dist/TrafgFood"
rm -rf build "$OUT" dist/TrafgFood-Windows.zip && mkdir -p "$WORK" "$OUT/server"

npx esbuild desktop/launcher.cjs --bundle --platform=node --target=node22 --format=cjs --outfile=build/trafgfood.cjs --log-level=error
echo '{ "main": "build/trafgfood.cjs", "output": "build/sea-prep.blob", "disableExperimentalSEAWarning": true }' > build/sea-config.json
node --experimental-sea-config build/sea-config.json

ZIP="node-$NODE_V-win-x64.zip"
curl -sSL -o "$WORK/$ZIP" "https://nodejs.org/dist/$NODE_V/$ZIP"
(cd "$WORK" && curl -sSL "https://nodejs.org/dist/$NODE_V/SHASUMS256.txt" | grep " $ZIP\$" | sha256sum -c -)
unzip -qj "$WORK/$ZIP" "node-$NODE_V-win-x64/node.exe" -d "$WORK"
cp "$WORK/node.exe" "$OUT/TrafgFood.exe"
python3 scripts/strip-signature.py "$OUT/TrafgFood.exe"
npx postject "$OUT/TrafgFood.exe" NODE_SEA_BLOB build/sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2

cp -r web "$OUT/web"
cp -r server/knowledge "$OUT/server/knowledge"
sed 's/$/\r/' desktop/LEIA-ME.txt > "$OUT/LEIA-ME.txt"
cp desktop/win/* desktop/trafgfood.ico "$OUT/"
(cd dist && zip -qr TrafgFood-Windows.zip TrafgFood)
echo "Pronto: dist/TrafgFood-Windows.zip"
