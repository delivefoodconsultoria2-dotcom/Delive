// Chaves e ajustes digitados dentro do app (tela Configurações).
// Ficam em DATA_DIR/config.json, só no servidor; a tela nunca recebe um segredo de volta,
// só "salvo" e os 4 últimos caracteres. Valor salvo aqui vale mais que a variável de ambiente.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const DATA_DIR = process.env.DATA_DIR || path.resolve("data");
const FILE = path.join(DATA_DIR, "config.json");

export const GRUPOS = [
  {
    id: "claude",
    titulo: "Gestor de tráfego IA (Claude)",
    ajuda: "Crie em console.anthropic.com > API Keys. Precisa ter crédito em Billing.",
    campos: [{ key: "ANTHROPIC_API_KEY", label: "Chave da Claude API", secret: true, placeholder: "sk-ant-api03-...", prefixo: "sk-ant-api" }],
  },
  {
    id: "google",
    titulo: "Google Ads",
    ajuda: "Client ID e Client Secret em console.cloud.google.com > Credenciais. O refresh token sai do botão Conectar com Google, logo abaixo.",
    campos: [
      { key: "GOOGLE_ADS_CLIENT_ID", label: "Client ID", placeholder: "...apps.googleusercontent.com" },
      { key: "GOOGLE_ADS_CLIENT_SECRET", label: "Client Secret", secret: true, placeholder: "GOCSPX-..." },
      { key: "GOOGLE_ADS_REFRESH_TOKEN", label: "Refresh token", secret: true, placeholder: "1//...", prefixo: "1//" },
      { key: "GOOGLE_ADS_LOGIN_CUSTOMER_ID", label: "ID da conta de administrador (MCC)", placeholder: "123-456-7890" },
      { key: "GOOGLE_ADS_DEVELOPER_TOKEN", label: "Developer token (se o Google pedir)", secret: true, placeholder: "deixe vazio se não tiver", proibido: "4/" },
    ],
  },
  {
    id: "meta",
    titulo: "Meta (Facebook e Instagram)",
    ajuda: "Token de Usuário do Sistema: business.facebook.com > Configurações > Usuários do sistema > Gerar token (ads_management, ads_read).",
    campos: [{ key: "META_ACCESS_TOKEN", label: "Token de acesso", secret: true, placeholder: "EAA..." }],
  },
  {
    id: "acesso",
    titulo: "Acesso ao TrafgFood",
    ajuda: "Nome que aparece no app e senha para entrar. No computador a senha é opcional.",
    campos: [
      { key: "APP_USER_NAME", label: "Seu nome", placeholder: "Edson Jr" },
      { key: "APP_PASSWORD", label: "Senha para entrar", secret: true, placeholder: "deixe vazio para entrar direto" },
    ],
  },
];
const CAMPOS = Object.fromEntries(GRUPOS.flatMap((g) => g.campos.map((c) => [c.key, c])));

let cfg = { valores: {}, testes: {} };
const ENV_ORIGINAL = { ...process.env };

function read() {
  try {
    const j = JSON.parse(fs.readFileSync(FILE, "utf8"));
    cfg = { valores: j.valores || {}, testes: j.testes || {}, sessao: j.sessao };
  } catch {}
}
function write() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, FILE);
}
function apply() {
  for (const key of Object.keys(CAMPOS)) {
    const v = cfg.valores[key];
    if (v) process.env[key] = v;
    else if (ENV_ORIGINAL[key]) process.env[key] = ENV_ORIGINAL[key];
    else delete process.env[key];
  }
}

const ouvintes = [];
export const onChange = (fn) => ouvintes.push(fn);

// Carrega no início. Também guarda um segredo de sessão fixo para o login não cair a cada reinício.
export function loadSettings() {
  read();
  if (!process.env.SESSION_SECRET) {
    if (!cfg.sessao) { cfg.sessao = crypto.randomBytes(32).toString("hex"); write(); }
    process.env.SESSION_SECRET = cfg.sessao;
  }
  apply();
}

// Para a tela: segredos viram "salvo · final 1234"; nunca devolve o valor.
export function publicSettings() {
  return GRUPOS.map((g) => ({
    id: g.id, titulo: g.titulo, ajuda: g.ajuda, teste: cfg.testes[g.id] || null,
    campos: g.campos.map((c) => {
      const v = process.env[c.key] || "";
      const origem = cfg.valores[c.key] ? "app" : v ? "servidor" : "";
      return c.secret
        ? { key: c.key, label: c.label, secret: true, placeholder: c.placeholder, salvo: Boolean(v), final: v ? v.slice(-4) : "", origem }
        : { key: c.key, label: c.label, placeholder: c.placeholder, valor: v, origem };
    }),
  }));
}

// patch: { CHAVE: "novo valor" } troca; { CHAVE: null } apaga. Campos secretos vazios são ignorados.
export function saveSettings(patch) {
  const mudou = new Set();
  for (const [key, raw] of Object.entries(patch || {})) {
    const c = CAMPOS[key];
    if (!c) continue;
    if (raw === null) { delete cfg.valores[key]; mudou.add(key); continue; }
    const v = String(raw).trim();
    if (!v && c.secret) continue;
    if (c.proibido && v.startsWith(c.proibido)) throw new Error(`${c.label}: isso é um código de autorização (começa com ${c.proibido}), não o developer token. Deixe vazio se não tiver.`);
    if (c.prefixo && v && !v.startsWith(c.prefixo)) throw new Error(`${c.label} deve começar com ${c.prefixo}. Confira se copiou o valor certo.`);
    if (/\s/.test(v)) throw new Error(`${c.label} tem espaço no meio. Copie de novo, sem espaços.`);
    if (v) cfg.valores[key] = v; else delete cfg.valores[key];
    mudou.add(key);
  }
  if (!mudou.size) return publicSettings();
  for (const g of GRUPOS) if (g.campos.some((c) => mudou.has(c.key))) delete cfg.testes[g.id];
  write();
  apply();
  ouvintes.forEach((fn) => fn(mudou));
  return publicSettings();
}

export function recordTest(grupo, ok, msg) {
  cfg.testes[grupo] = { ok, msg, em: new Date().toISOString() };
  write();
  return cfg.testes[grupo];
}
