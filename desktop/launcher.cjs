// Entrada do TrafgFood.exe. Roda sem janela: sobe o servidor só para este computador
// e abre o navegador. As chaves são colocadas na tela Configurações do próprio app.
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { exec } = require("node:child_process");

const DIR = path.dirname(process.execPath);
// Instalado: dados em %APPDATA%\TrafgFood (sobrevivem a atualizações e reinstalações).
const DADOS = process.env.APPDATA ? path.join(process.env.APPDATA, "TrafgFood") : path.join(DIR, "dados");
fs.mkdirSync(DADOS, { recursive: true });

// Sem janela, o que aconteceu fica em trafgfood-log.txt na pasta de dados.
const LOG = path.join(DADOS, "trafgfood-log.txt");
try { if (fs.statSync(LOG).size > 1e6) fs.rmSync(LOG); } catch (_) {}
for (const k of ["log", "warn", "error"]) {
  const orig = console[k].bind(console);
  console[k] = (...a) => {
    try { orig(...a); } catch (_) {}
    try { fs.appendFileSync(LOG, `[${new Date().toLocaleString("pt-BR")}] ${a.map((x) => (x && x.stack) || x).join(" ")}\r\n`); } catch (_) {}
  };
}

// Compatibilidade com a versão anterior: configuracao.txt ao lado do .exe ainda é lido.
for (const f of [path.join(DIR, "configuracao.txt"), path.join(DADOS, "configuracao.txt")]) {
  if (!fs.existsSync(f)) continue;
  for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && m[2] && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
if (/^4\//.test(process.env.GOOGLE_ADS_DEVELOPER_TOKEN || "")) delete process.env.GOOGLE_ADS_DEVELOPER_TOKEN;

process.env.TF_ROOT = DIR;
process.env.DATA_DIR ||= DADOS;
process.env.HOST ||= "127.0.0.1";
process.env.APP_USER_NAME ||= "Edson Jr";
const PORT = Number(process.env.PORT || 3847);
process.env.PORT = String(PORT);

// --segundo-plano: usado ao ligar com o Windows; não abre o navegador.
const SEGUNDO_PLANO = process.argv.includes("--segundo-plano");
const URL_APP = `http://localhost:${PORT}`;
const abrir = () =>
  exec(process.platform === "win32" ? `start "" "${URL_APP}"` : process.platform === "darwin" ? `open "${URL_APP}"` : `xdg-open "${URL_APP}"`);

process.on("trafgfood:pronto", () => SEGUNDO_PLANO || abrir());
process.on("uncaughtException", (e) => {
  console.error("O TrafgFood parou:", e);
  if (e.code === "EADDRINUSE") console.error(`A porta ${PORT} está ocupada por outro programa.`);
  process.exit(1);
});

console.log(`TrafgFood iniciando em ${URL_APP} (dados em ${DADOS})`);

// Se o TrafgFood já estiver ligado, só abre o navegador e sai.
const req = http.get({ host: "127.0.0.1", port: PORT, path: "/manifest.webmanifest", timeout: 1500 }, (res) => {
  res.resume();
  if (!SEGUNDO_PLANO) abrir();
  console.log("Já estava ligado; abri o navegador.");
  setTimeout(() => process.exit(0), 1500);
});
req.on("timeout", () => req.destroy());
req.on("error", () => require("../server/index.js"));
