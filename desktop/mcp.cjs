// TrafgFood.exe --mcp: ponte entre o app do Claude (assinatura da pessoa) e o TrafgFood.
// Fala MCP por stdin/stdout e repassa para o TrafgFood que roda neste computador.
// As ferramentas só leem números e criam PROPOSTAS; quem aplica é a pessoa, no "Confirmar" do TrafgFood.
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");

const DIR = path.dirname(process.execPath);
const DADOS = process.env.APPDATA ? path.join(process.env.APPDATA, "TrafgFood") : path.join(DIR, "dados");
const PORT = Number(process.env.PORT || 3847);
const LOG = path.join(DADOS, "trafgfood-log.txt");
const log = (...a) => { try { fs.appendFileSync(LOG, `[${new Date().toLocaleString("pt-BR")}] [ponte Claude] ${a.join(" ")}\r\n`); } catch (_) {} };
// stdout é do protocolo: qualquer console.* vai só para o log.
for (const k of ["log", "info", "warn", "error"]) console[k] = log;

const INSTRUCOES = `Você é o gestor de tráfego pago (Meta e Google Ads) da Delivefood Consultoria, especialista em restaurantes e delivery, trabalhando pelo TrafgFood.
Antes da primeira análise da conversa, chame manual_do_gestor e siga a base de conhecimento dele (fórmulas de ROAS de equilíbrio e CPA máximo por loja, árvore de diagnóstico, regras de escala).
Use buscar_campanhas antes de opinar sobre números. As ferramentas propor_* NÃO aplicam nada: criam uma proposta que a pessoa confirma no TrafgFood, no painel, em "Aguardando sua confirmação". Diga "deixei pronto para você confirmar no TrafgFood", nunca "fiz".
Fale em português do Brasil, sem jargão, e termine com a próxima ação e a métrica que decide.`;

function pedir(method, p, body) {
  let token = "";
  try { token = fs.readFileSync(path.join(DADOS, "ponte-claude.token"), "utf8").trim(); } catch (_) {}
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ host: "127.0.0.1", port: PORT, path: p, method, timeout: 120000,
      headers: { "x-tf-ponte": token, ...(data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}) } }, (res) => {
      let txt = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (txt += c));
      res.on("end", () => {
        let j = {};
        try { j = JSON.parse(txt); } catch (_) {}
        res.statusCode < 400 ? resolve(j) : reject(new Error(j.erro || `TrafgFood respondeu ${res.statusCode}`));
      });
    });
    req.on("timeout", () => req.destroy(new Error("O TrafgFood demorou para responder.")));
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

// Liga o TrafgFood em segundo plano se ele estiver desligado.
async function garantirLigado() {
  try { await pedir("GET", "/api/ponte/manual"); return; } catch (e) { if (!/ECONNREFUSED|ECONNRESET/.test(e.code || e.message)) throw e; }
  log("TrafgFood desligado; ligando em segundo plano.");
  spawn(process.execPath, ["--segundo-plano"], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try { await pedir("GET", "/api/ponte/manual"); return; } catch (_) {}
  }
  throw new Error("Não consegui ligar o TrafgFood. Abra o TrafgFood pelo ícone e tente de novo.");
}

let cacheManual = null;
async function manual() {
  if (!cacheManual) { await garantirLigado(); cacheManual = await pedir("GET", "/api/ponte/manual"); }
  return cacheManual;
}

async function listarFerramentas() {
  const m = await manual();
  return [
    { name: "manual_do_gestor", description: "Base de conhecimento de tráfego pago da Delivefood (fórmulas, diagnóstico, regras de escala). Chame uma vez antes de analisar.", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
    ...m.ferramentas.map((t) => ({ name: t.name, description: t.description + (t.name.startsWith("propor_") ? " Não aplica nada: a pessoa confirma no TrafgFood." : ""), inputSchema: t.input_schema,
      annotations: { readOnlyHint: ["buscar_campanhas", "diagnostico_automatico"].includes(t.name), destructiveHint: false } })),
  ];
}

// Resposta sempre em JSON (o painel do TrafgFood dentro do Claude lê como dados).
async function chamar(nome, args) {
  if (nome === "manual_do_gestor") return { manual: (await manual()).manual };
  await garantirLigado();
  const out = await pedir("POST", "/api/ponte/ferramenta", { nome, args });
  if (nome === "buscar_campanhas" || nome === "diagnostico_automatico") return Array.isArray(out) ? { itens: out } : out;
  return { ...out, aviso: "Proposta criada. Ela só vale depois que a pessoa tocar em Confirmar no TrafgFood (Painel > Aguardando sua confirmação)." };
}

const enviar = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");

async function tratar(msg) {
  const { id, method, params } = msg;
  if (id === undefined || id === null) return; // notificações
  try {
    let result;
    if (method === "initialize") {
      result = { protocolVersion: params?.protocolVersion || "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "trafgfood", version: "1.2.0" }, instructions: INSTRUCOES };
    } else if (method === "ping") result = {};
    else if (method === "tools/list") result = { tools: await listarFerramentas() };
    else if (method === "tools/call") {
      try { const r = await chamar(params.name, params.arguments || {}); result = { content: [{ type: "text", text: JSON.stringify(r) }], structuredContent: r }; }
      catch (e) { log("erro em", params?.name, e.message); result = { content: [{ type: "text", text: e.message }], isError: true }; }
    } else if (method === "resources/list") result = { resources: [] };
    else if (method === "prompts/list") result = { prompts: [] };
    else return enviar({ jsonrpc: "2.0", id, error: { code: -32601, message: "Método não suportado: " + method } });
    enviar({ jsonrpc: "2.0", id, result });
  } catch (e) {
    log("erro", method, e.message);
    enviar({ jsonrpc: "2.0", id, error: { code: -32603, message: e.message } });
  }
}

log("ponte iniciada");
let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    try { tratar(JSON.parse(line)); } catch (e) { log("linha inválida", e.message); }
  }
});
process.stdin.on("end", () => process.exit(0));
