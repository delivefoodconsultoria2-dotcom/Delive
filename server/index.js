import express from "express";
import crypto from "node:crypto";
import path from "node:path";
import { store } from "./store.js";
import { seedIfEmpty } from "./providers/mock.js";
import { state, propose, confirm, reject, invalidate } from "./actions.js";
import { ask } from "./copilot.js";
import { ROOT } from "./paths.js";
import { loadSettings, publicSettings, saveSettings, recordTest, onChange } from "./settings.js";
import { testar } from "./testes.js";
import { resetGoogleToken } from "./providers/google.js";

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

app.use("/api", (req, res, next) => (cookieOk(req) ? next() : res.status(401).json({ erro: "Entre com a senha." })));

const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((e) => {
    console.error(e);
    res.status(400).json({ erro: e.message || "Erro inesperado." });
  });

app.get("/api/state", wrap(async (_req, res) => res.json({ ...(await state()), usuario: user(), senhaAtiva: Boolean(pass()), desktop: Boolean(process.env.TF_ROOT) })));
app.post("/api/refresh", wrap(async (_req, res) => { invalidate(); res.json(await state()); }));

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
    });
    return { ...c, nova };
  });
  store.audit({ quem: user(), origem: "tela", acao: "loja", resultado: (out.nova ? "Loja cadastrada: " : "Loja atualizada: ") + out.nome });
  invalidate();
  res.json(out);
}));

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
