import express from "express";
import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import { store } from "./store.js";
import { seedIfEmpty } from "./providers/mock.js";
import { state, propose, confirm, reject, invalidate, descartarRascunho } from "./actions.js";
import { ask, runTool, TOOLS, PLAYBOOK } from "./copilot.js";
import { ROOT } from "./paths.js";
import { loadSettings, publicSettings, saveSettings, recordTest, onChange } from "./settings.js";
import { testar } from "./testes.js";
import { resetGoogleToken } from "./providers/google.js";
import { diagnosticar } from "./diagnostico.js";
import { campaigns } from "./actions.js";
import { salvarImagem, caminhoImagem } from "./imagens.js";
import { paginasMeta } from "./providers/meta.js";
import { dicasCriacao } from "./especialista.js";
import { statusClaudeDesktop, conectarClaudeDesktop } from "./claude-desktop.js";

const PORT = Number(process.env.PORT || 3000);
loadSettings();
// Lidos a cada uso: podem mudar pela tela Configurações.
const pass = () => process.env.APP_PASSWORD || "";
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const user = () => process.env.APP_USER_NAME || "Gestor";
onChange(() => { invalidate(); resetGoogleToken(); });
const WEB = path.join(ROOT, "web");

if (!pass() && process.env.HOST !== "127.0.0.1") console.warn("Aviso: APP_PASSWORD vazio. Qualquer pessoa com o endereço consegue entrar.");

seedIfEmpty();
const app = express();
app.set("trust proxy", 1);
app.use("/api/imagens", express.json({ limit: "12mb" }));
app.use(express.json({ limit: "200kb" }));

// ---- login simples por senha, com cookie assinado ----
const sign = (v) => v + "." + crypto.createHmac("sha256", SECRET).update(v).digest("base64url");
function cookieOk(req) {
  if (!pass()) return true;
  const raw = (req.headers.cookie || "").split(/;\s*/).find((c) => c.startsWith("tf="));
  if (!raw) return false;
  const val = decodeURIComponent(raw.slice(3));
  const [exp] = val.split(".");
  const a = Buffer.from(sign(exp));
  const b = Buffer.from(val);
  return a.length === b.length && crypto.timingSafeEqual(a, b) && Number(exp) > Date.now();
}

function sessionCookie(req) {
  const exp = String(Date.now() + 30 * 864e5);
  return `tf=${encodeURIComponent(sign(exp))}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 86400}${req.secure ? "; Secure" : ""}`;
}
app.post("/api/login", (req, res) => {
  const given = Buffer.from(String(req.body?.senha || ""));
  const want = Buffer.from(pass());
  if (pass() && !(given.length === want.length && crypto.timingSafeEqual(given, want))) {
    return res.status(401).json({ erro: "Senha incorreta." });
  }
  res.setHeader("Set-Cookie", sessionCookie(req));
  res.json({ ok: true });
});
app.post("/api/logout", (_req, res) => {
  res.setHeader("Set-Cookie", "tf=; HttpOnly; Path=/; Max-Age=0");
  res.json({ ok: true });
});

// Ponte com o app do Claude (TrafgFood.exe --mcp): usa um token local guardado na pasta de dados.
const TOKEN_LOCAL = crypto.createHmac("sha256", SECRET).update("ponte-claude").digest("hex");
if (process.env.TF_ROOT) {
  try { fs.writeFileSync(path.join(process.env.DATA_DIR || "data", "ponte-claude.token"), TOKEN_LOCAL, { mode: 0o600 }); } catch (e) { console.error(e); }
}
const localOk = (req) => {
  const t = Buffer.from(String(req.headers["x-tf-ponte"] || "")), w = Buffer.from(TOKEN_LOCAL);
  return Boolean(process.env.TF_ROOT) && t.length === w.length && crypto.timingSafeEqual(t, w);
};
app.use("/api", (req, res, next) => (cookieOk(req) || localOk(req) ? next() : res.status(401).json({ erro: "Entre com a senha." })));

const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((e) => {
    console.error(e);
    res.status(400).json({ erro: e.message || "Erro inesperado." });
  });

const estadoCompleto = async () => ({ ...(await state()), usuario: user(), senhaAtiva: Boolean(pass()), desktop: Boolean(process.env.TF_ROOT) });
app.get("/api/state", wrap(async (_req, res) => res.json(await estadoCompleto())));
app.post("/api/refresh", wrap(async (_req, res) => { invalidate(); res.json(await estadoCompleto()); }));

app.post("/api/actions", wrap(async (req, res) => {
  const { tipo, campanhaId, dados } = req.body || {};
  res.json(await propose({ tipo, campanhaId, dados, origem: "tela" }));
}));
app.post("/api/actions/:id/confirm", wrap(async (req, res) => res.json(await confirm(req.params.id, user()))));
app.post("/api/actions/:id/reject", wrap(async (req, res) => res.json(reject(req.params.id) || {})));

app.post("/api/copilot", wrap(async (req, res) => {
  const history = Array.isArray(req.body?.history) ? req.body.history : [];
  if (!history.length) throw new Error("Mensagem vazia.");
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) throw new Error("O gestor IA está desligado. Coloque a chave da Claude API em Configurações.");
  try {
    res.json(await ask(history));
  } catch (e) {
    if (e.status === 401) throw new Error("A chave da Claude API (ANTHROPIC_API_KEY) está errada ou foi apagada. Gere outra em console.anthropic.com.");
    if (e.status === 402 || /credit|billing/i.test(e.message)) throw new Error("A conta da Claude API está sem créditos. Adicione em console.anthropic.com > Billing.");
    throw e;
  }
}));

// Cadastro de lojas e das contas de anúncio de cada uma.
app.post("/api/clients", wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.nome) throw new Error("Informe o nome da loja.");
  const out = store.update((d) => {
    let c = b.id && d.clients.find((x) => x.id === b.id);
    const nova = !c;
    if (!c) {
      c = { id: store.id("loja") };
      d.clients.push(c);
    }
    Object.assign(c, {
      nome: String(b.nome),
      cor: /^#[0-9a-f]{6}$/i.test(b.cor) ? b.cor : c.cor || "#1DB46A",
      cidade: String(b.cidade || ""),
      ticket: Number(b.ticket) || 0,
      margem: Number(b.margem) || 0,
      metaAdAccountId: String(b.metaAdAccountId || "").trim(),
      googleCustomerId: String(b.googleCustomerId || "").trim(),
      foco: b.foco === "servico" ? "servico" : "comida",
      endereco: String(b.endereco || "").trim(),
    });
    if (!c.endereco) { delete c.lat; delete c.lng; }
    return { ...c, nova };
  });
  // Endereço vira coordenada (OpenStreetMap) para anunciar no raio de entrega.
  const atual = store.get().clients.find((x) => x.id === out.id);
  if (atual.endereco && atual.endereco !== atual.geoDe) {
    const geo = await geocodificar(atual.endereco).catch(() => null);
    store.update(() => { if (geo) { atual.lat = geo.lat; atual.lng = geo.lng; atual.geoDe = atual.endereco; } else { delete atual.lat; delete atual.lng; delete atual.geoDe; } });
    out.endereco_ok = Boolean(geo);
  }
  store.audit({ quem: user(), origem: "tela", acao: "loja", resultado: (out.nova ? "Loja cadastrada: " : "Loja atualizada: ") + out.nome });
  invalidate();
  res.json(out);
}));

async function geocodificar(endereco) {
  const u = new URL("https://nominatim.openstreetmap.org/search");
  u.search = new URLSearchParams({ q: endereco, format: "json", limit: "1", countrycodes: "br" });
  const r = await fetch(u, { headers: { "User-Agent": "TrafgFood/1.0 (Delivefood Consultoria)", "Accept-Language": "pt-BR" } });
  const [hit] = await r.json();
  return hit ? { lat: Number(hit.lat), lng: Number(hit.lon) } : null;
}

app.post("/api/rascunhos/:id/descartar", wrap(async (req, res) => { descartarRascunho(req.params.id); res.json({ ok: true }); }));

// Fotos dos anúncios e páginas da Meta, usadas na criação de campanha.
app.post("/api/imagens", wrap(async (req, res) => res.json(salvarImagem(req.body?.dados, req.body?.nome))));
app.get("/api/imagens/:id", wrap(async (req, res) => res.sendFile(caminhoImagem(req.params.id))));
app.get("/api/meta/paginas", wrap(async (_req, res) => {
  if (!process.env.META_ACCESS_TOKEN) throw new Error("Coloque o token da Meta em Configurações.");
  res.json(await paginasMeta());
}));
app.get("/api/especialista", wrap(async (req, res) => res.json(dicasCriacao(req.query.foco === "servico" ? "servico" : "comida"))));

// Excluir tira a loja só do TrafgFood. As contas e campanhas nas plataformas continuam como estão.
app.delete("/api/clients/:id", wrap(async (req, res) => {
  const nome = store.update((d) => {
    const c = d.clients.find((x) => x.id === req.params.id);
    if (!c) throw new Error("Loja não encontrada.");
    d.clients = d.clients.filter((x) => x.id !== c.id);
    d.actions = d.actions.filter((a) => !(a.status === "pendente" && a.dados?.clientId === c.id));
    return c.nome;
  });
  store.audit({ quem: user(), origem: "tela", acao: "excluir_loja", resultado: "Loja excluída: " + nome });
  invalidate();
  res.json({ ok: true });
}));

// Configurações: as chaves são digitadas aqui e nunca voltam para a tela.
app.get("/api/config", (_req, res) => res.json(publicSettings()));
app.post("/api/config", wrap(async (req, res) => {
  const out = saveSettings(req.body || {});
  // Quem acabou de criar a senha continua logado.
  if (req.body?.APP_PASSWORD) res.setHeader("Set-Cookie", sessionCookie(req));
  store.audit({ quem: user(), origem: "tela", acao: "config", resultado: "Configurações atualizadas: " + Object.keys(req.body || {}).filter((k) => req.body[k] !== "").length + " campo(s)" });
  res.json(out);
}));
app.post("/api/config/test/:grupo", wrap(async (req, res) => {
  let r;
  try { r = recordTest(req.params.grupo, true, await testar(req.params.grupo)); }
  catch (e) { r = recordTest(req.params.grupo, false, e.message); }
  invalidate();
  res.json(r);
}));
// "Conectar com Google": gera o refresh token sozinho, sem OAuth Playground.
// O endereço de retorno (…/api/google/callback) precisa estar nos "URIs de redirecionamento autorizados" do Client ID.
const oauthStates = new Map();
const retornoGoogle = (req) => `${req.protocol}://${req.get("host")}/api/google/callback`;
app.get("/api/google/conectar", (req, res) => {
  if (!process.env.GOOGLE_ADS_CLIENT_ID || !process.env.GOOGLE_ADS_CLIENT_SECRET) return res.redirect("/?google=" + encodeURIComponent("Salve o Client ID e o Client Secret antes de conectar.") + "#config");
  const st = crypto.randomBytes(16).toString("hex");
  oauthStates.set(st, Date.now());
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.search = new URLSearchParams({
    client_id: process.env.GOOGLE_ADS_CLIENT_ID, redirect_uri: retornoGoogle(req), response_type: "code",
    scope: "https://www.googleapis.com/auth/adwords", access_type: "offline", prompt: "select_account consent", state: st,
  });
  res.redirect(u.toString());
});
app.get("/api/google/callback", wrap(async (req, res) => {
  const volta = (msg) => res.redirect("/?google=" + encodeURIComponent(msg) + "#config");
  const { code, state: st, error } = req.query;
  if (error) return volta(error === "access_denied" ? "Você cancelou o acesso no Google." : "O Google respondeu: " + error);
  if (!st || !oauthStates.has(st) || Date.now() - oauthStates.get(st) > 15 * 60e3) return volta("O pedido de conexão expirou. Clique em Conectar com Google de novo.");
  oauthStates.delete(st);
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({ code: String(code), client_id: process.env.GOOGLE_ADS_CLIENT_ID, client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET, redirect_uri: retornoGoogle(req), grant_type: "authorization_code" }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return volta("O Google não aceitou: " + (j.error_description || j.error || r.statusText));
  if (!j.refresh_token) return volta("O Google não mandou o refresh token. Remova o acesso do TrafgFood em myaccount.google.com/permissions e conecte de novo.");
  saveSettings({ GOOGLE_ADS_REFRESH_TOKEN: j.refresh_token });
  store.audit({ quem: user(), origem: "tela", acao: "config", resultado: "Google Ads conectado pelo botão Conectar com Google" });
  try { recordTest("google", true, await testar("google")); } catch (e) { recordTest("google", false, e.message); }
  invalidate();
  volta("ok");
}));

// Ferramentas usadas pelo app do Claude. Nada é aplicado: propostas esperam o "Confirmar" na tela.
app.get("/api/ponte/manual", (_req, res) => res.json({ manual: PLAYBOOK, ferramentas: TOOLS }));
app.post("/api/ponte/ferramenta", wrap(async (req, res) => {
  const { nome, args } = req.body || {};
  if (!TOOLS.some((t) => t.name === nome)) throw new Error("Ferramenta desconhecida: " + nome);
  const lojas = store.get().clients.map((c) => ({ id: c.id, nome: c.nome, cidade: c.cidade, ticket_medio: c.ticket, margem_pct: c.margem || null, foco: c.foco || "comida", tem_meta: Boolean(c.metaAdAccountId), tem_google: Boolean(c.googleCustomerId), tem_endereco: c.lat != null }));
  const out = await runTool(nome, args || {}, [], "Claude (app)");
  res.json(nome === "buscar_campanhas" ? { lojas, campanhas: out } : out);
}));

app.get("/api/diagnostico", wrap(async (_req, res) => { const { data } = await campaigns(); res.json(diagnosticar(data, store.get().clients)); }));
app.get("/api/claude-app", (_req, res) => res.json(process.env.TF_ROOT ? statusClaudeDesktop() : { instalado: false, ligado: false, servidor: true }));
app.post("/api/claude-app/conectar", wrap(async (_req, res) => res.json({ msg: conectarClaudeDesktop(), ...statusClaudeDesktop() })));

// Só no TrafgFood instalado no computador: desliga o programa.
app.post("/api/desligar", (_req, res) => {
  if (!process.env.TF_ROOT) return res.status(400).json({ erro: "Só funciona no TrafgFood instalado no computador." });
  res.json({ ok: true });
  setTimeout(() => process.exit(0), 300);
});

app.use(express.static(WEB, { extensions: ["html"] }));
app.get("*", (_req, res) => res.sendFile(path.join(WEB, "index.html")));

// HOST=127.0.0.1 deixa o app visível só neste computador (usado pelo TrafgFood.exe).
app.listen(PORT, process.env.HOST || undefined, () => {
  console.log(`TrafgFood rodando em http://localhost:${PORT}`);
  process.emit("trafgfood:pronto", PORT);
});
