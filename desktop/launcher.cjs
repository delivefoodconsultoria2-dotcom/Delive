// Entrada do TrafgFood.exe: lê configuracao.txt ao lado do .exe, sobe o servidor
// só para este computador e abre o navegador.
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
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

// Guarda o que aparece na janela em trafgfood-log.txt (útil quando roda escondido).
const LOG = path.join(DIR, "trafgfood-log.txt");
try { if (fs.statSync(LOG).size > 1e6) fs.rmSync(LOG); } catch (_) {}
for (const k of ["log", "warn", "error"]) {
  const orig = console[k].bind(console);
  console[k] = (...a) => { orig(...a); try { fs.appendFileSync(LOG, `[${new Date().toLocaleString("pt-BR")}] ${a.join(" ")}\r\n`); } catch (_) {} };
}

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

// --segundo-plano: usado ao ligar com o Windows; não abre o navegador.
const SEGUNDO_PLANO = process.argv.includes("--segundo-plano");
// Avisos para os erros de preenchimento mais comuns no configuracao.txt.
const E = process.env;
if (E.ANTHROPIC_API_KEY && !E.ANTHROPIC_API_KEY.startsWith("sk-ant-api")) console.log("Atenção: ANTHROPIC_API_KEY não parece uma chave de API. Ela deve começar com sk-ant-api. Gere em console.anthropic.com > API Keys.");
if (/^4\//.test(E.GOOGLE_ADS_DEVELOPER_TOKEN || "")) console.log("Atenção: GOOGLE_ADS_DEVELOPER_TOKEN está com um código de autorização (começa com 4/). O developer token vem de ads.google.com > Central de API; se não tiver, deixe vazio."), delete E.GOOGLE_ADS_DEVELOPER_TOKEN;
if (E.GOOGLE_ADS_CLIENT_SECRET && !E.GOOGLE_ADS_REFRESH_TOKEN) console.log("Atenção: falta GOOGLE_ADS_REFRESH_TOKEN (começa com 1//). Sem ele o Google Ads fica em modo exemplo.");
else if (E.GOOGLE_ADS_REFRESH_TOKEN && !E.GOOGLE_ADS_REFRESH_TOKEN.startsWith("1//")) console.log("Atenção: GOOGLE_ADS_REFRESH_TOKEN deve começar com 1//. Use o refresh token, não o código de autorização.");

const abrir = (url) => exec(process.platform === "win32" ? `start "" "${url}"` : process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`);
process.on("trafgfood:pronto", (port) => SEGUNDO_PLANO || abrir(`http://localhost:${port}`));
process.on("uncaughtException", (e) => {
  console.error("\nO TrafgFood parou: " + e.message);
  if (e.code === "EADDRINUSE") console.error("Já existe um TrafgFood aberto. Use a janela que já está aberta ou mude PORT em configuracao.txt.");
  setTimeout(() => process.exit(1), 60_000);
});

// Se o TrafgFood já estiver ligado, só abre o navegador e sai.
const PORT = Number(process.env.PORT || 3000);
const req = http.get({ host: "127.0.0.1", port: PORT, path: "/manifest.webmanifest", timeout: 1500 }, (res) => {
  res.resume();
  if (!SEGUNDO_PLANO) abrir(`http://localhost:${PORT}`);
  console.log("O TrafgFood já está ligado. Abri no navegador.");
  setTimeout(() => process.exit(0), 1500);
});
req.on("timeout", () => req.destroy());
req.on("error", () => require("../server/index.js"));
