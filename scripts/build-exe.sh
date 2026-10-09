#!/usr/bin/env bash
# Gera dist/Instalar-TrafgFood.exe: TrafgFood.exe (Node SEA, sem janela de console)
# + telas + base de conhecimento, empacotados num instalador NSIS em português.
# Precisa de: node (mesma versão de NODE_V), python3, makensis, wine (para o ícone e versão do .exe).
set -euo pipefail
cd "$(dirname "$0")/.."
NODE_V="${NODE_V:-$(node -v)}"
VERSAO="$(node -p 'require("./package.json").version')"
WORK="build/win"; APP="dist/TrafgFood"
rm -rf build dist && mkdir -p "$WORK" "$APP/server"

npx esbuild desktop/launcher.cjs --bundle --platform=node --target=node22 --format=cjs --outfile=build/trafgfood.cjs --log-level=error
echo '{ "main": "build/trafgfood.cjs", "output": "build/sea-prep.blob", "disableExperimentalSEAWarning": true }' > build/sea-config.json
node --experimental-sea-config build/sea-config.json

ZIP="node-$NODE_V-win-x64.zip"
curl -sSL -o "$WORK/$ZIP" "https://nodejs.org/dist/$NODE_V/$ZIP"
(cd "$WORK" && curl -sSL "https://nodejs.org/dist/$NODE_V/SHASUMS256.txt" | grep " $ZIP\$" | sha256sum -c -)
unzip -qj "$WORK/$ZIP" "node-$NODE_V-win-x64/node.exe" -d "$WORK"

EXE="$APP/TrafgFood.exe"
cp "$WORK/node.exe" "$EXE"
python3 scripts/strip-signature.py "$EXE"
# Ícone e dados do programa (Propriedades > Detalhes) no nome da Delivefood.
WINEDEBUG=-all WINEPREFIX="${WINEPREFIX:-$PWD/build/wine}" "${WINE:-wine64}" node_modules/rcedit/bin/rcedit-x64.exe "$EXE" \
  --set-icon desktop/trafgfood.ico \
  --set-version-string ProductName TrafgFood --set-version-string FileDescription TrafgFood \
  --set-version-string CompanyName "Delivefood Consultoria" --set-version-string LegalCopyright "Delivefood Consultoria" \
  --set-version-string OriginalFilename TrafgFood.exe --set-version-string InternalName TrafgFood \
  --set-file-version "$VERSAO" --set-product-version "$VERSAO"
npx postject "$EXE" NODE_SEA_BLOB build/sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
python3 scripts/pe-gui.py "$EXE"

cp -r web "$APP/web"
cp -r server/knowledge "$APP/server/knowledge"
cp desktop/trafgfood.ico "$APP/"

makensis -V2 -DVERSAO="$VERSAO" -DPASTA="$PWD/$APP" -DSAIDA="$PWD/dist/Instalar-TrafgFood.exe" desktop/instalador.nsi
echo "Pronto: dist/Instalar-TrafgFood.exe"
