// Entrada do TrafgFood.exe: lê configuracao.txt ao lado do .exe, sobe o servidor
// só para este computador e abre o navegador.
const fs = require("node:fs");
const path = require("node:path");
const { exec } = require("node:child_process");

const DIR = path.dirname(process.execPath);
const CONFIG = path.join(DIR, "configuracao.txt");

const MODELO = `# Configuração do TrafgFood no seu computador.
# Preencha depois do sinal de igual, salve e abra o TrafgFood.exe de novo.
# Este arquivo fica só neste computador. Não mande para ninguém.

# Chave da Claude API (console.anthropic.com > API Keys). Sem ela o gestor IA fica desligado.
ANTHROPIC_API_KEY=

# Seu nome no app
APP_USER_NAME=Edson Jr

# Senha para entrar (opcional no computador; deixe vazio para entrar direto)
APP_PASSWORD=

# Google Ads (deixe vazio para usar dados de exemplo)
GOOGLE_ADS_CLIENT_ID=254869003126-06bfnsak41fr0f7483vd9k61cc7ajc2i.apps.googleusercontent.com
GOOGLE_ADS_CLIENT_SECRET=
GOOGLE_ADS_REFRESH_TOKEN=
GOOGLE_ADS_LOGIN_CUSTOMER_ID=6603441176
GOOGLE_ADS_DEVELOPER_TOKEN=

# Meta (Facebook e Instagram)
META_ACCESS_TOKEN=

# Porta do app no navegador
PORT=3000
`;

let novo = false;
if (!fs.existsSync(CONFIG)) {
  fs.writeFileSync(CONFIG, MODELO.replace(/\n/g, "\r\n"));
  novo = true;
}
for (const line of fs.readFileSync(CONFIG, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m && m[2] && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
process.env.TF_ROOT = DIR;
process.env.DATA_DIR ||= path.join(DIR, "dados");
process.env.HOST ||= "127.0.0.1";

console.log("TrafgFood · Delivefood Consultoria");
console.log("Deixe esta janela aberta enquanto usa o app. Para fechar o TrafgFood, feche esta janela.\n");
if (!process.env.ANTHROPIC_API_KEY) {
  console.log("O gestor IA está desligado: falta a ANTHROPIC_API_KEY em configuracao.txt.");
  if (novo) exec(`notepad "${CONFIG}"`);
}

const abrir = (url) => exec(process.platform === "win32" ? `start "" "${url}"` : process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`);
process.on("trafgfood:pronto", (port) => abrir(`http://localhost:${port}`));
process.on("uncaughtException", (e) => {
  console.error("\nO TrafgFood parou: " + e.message);
  if (e.code === "EADDRINUSE") console.error("Já existe um TrafgFood aberto. Use a janela que já está aberta ou mude PORT em configuracao.txt.");
  setTimeout(() => process.exit(1), 60_000);
});

require("../server/index.js");
