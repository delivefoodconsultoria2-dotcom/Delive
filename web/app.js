// TrafgFood: tela do gestor. Os números vêm do servidor (/api/state);
// toda mudança vira uma proposta que só é aplicada depois do "Confirmar".

const $ = (s) => document.querySelector(s);
const brl = (v) => "R$ " + Number(v || 0).toLocaleString("pt-BR", { maximumFractionDigits: 0 });
const brl2 = (v) => "R$ " + Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf = (v) => Number(v || 0).toLocaleString("pt-BR");
const dec = (v, n = 1) => Number(v).toFixed(n).replace(".", ",");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

let CLIENTES = [], CAMPANHAS = [], LOG = [], ERROS = {}, CONEX = {}, IA = false, ATUALIZADO = null, DESKTOP = false, CONFIG = null, PENDENTES = [], DIAG = null, CLAUDEAPP = null;
const cli = (id) => CLIENTES.find((c) => c.id === id) || { nome: id, cor: "#555" };
const camp = (id) => CAMPANHAS.find((c) => c.id === id);
const m = (c) => ({
  ctr: c.impressoes ? (c.cliques / c.impressoes) * 100 : 0,
  cpc: c.cliques ? c.gasto7 / c.cliques : 0,
  cpa: c.pedidos ? c.gasto7 / c.pedidos : 0,
  roas: c.gasto7 ? c.receita / c.gasto7 : 0,
});
// ROAS de equilíbrio = 1 / margem de contribuição (base de conhecimento Delivefood).
const equilibrio = (c) => { const mg = Number(cli(c.clientId).margem); return mg > 0 && mg < 100 ? 100 / mg : null; };
// Saúde pela régua da base Delivefood: ROAS abaixo do equilíbrio = prejuízo; até 30% acima = no limite.
const NIVEL = { bom: "Lucrando", limite: "No limite", ruim: "Prejuízo", semdado: "Sem dados", semmargem: "Sem margem" };
function saude(roas, gasto, pedidos, eq) {
  if (!eq) return "semmargem";
  if (!gasto) return "semdado";
  if (!pedidos || roas < eq) return "ruim";
  return roas < eq * 1.3 ? "limite" : "bom";
}
const badge = (n) => `<span class="hb ${n}">${NIVEL[n]}</span>`;
function resumoLoja(c) {
  const cs = CAMPANHAS.filter((x) => x.clientId === c.id), t = totais(cs);
  const mg = Number(c.margem) > 0 && Number(c.margem) < 100 ? Number(c.margem) / 100 : null;
  const eq = mg ? 1 / mg : null;
  return { ...t, cs, mg, eq, ativas: cs.filter((x) => x.status === "ativa").length, cpaMax: mg && c.ticket ? c.ticket * mg : null, lucro: mg ? t.r * mg - t.g : null, nivel: saude(t.roas, t.g, t.p, eq) };
}
const stLabel = { ativa: "Ativa", pausada: "Pausada", em_analise: "Em análise" };
const stClass = { ativa: "ativa", pausada: "pausada", em_analise: "analise" };
const platLabel = { meta: "Meta", google: "Google" };
const TITULOS = { painel: "Painel de resultados", campanhas: "Campanhas", copiloto: "Gestor de tráfego", clientes: "Lojas e contas", config: "Configurações" };

let state = { tab: "painel", client: "todos", plat: "todas", st: "todas", q: "", sort: { k: "gasto7", dir: -1 } };
try { const t = localStorage.getItem("ct_tab"); if (TITULOS[t]) state.tab = t; } catch (e) {}
const visiveis = () => CAMPANHAS.filter((c) => (state.client === "todos" || c.clientId === state.client) && (state.plat === "todas" || c.plataforma === state.plat));

function toast(t) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = t;
  document.body.append(el);
  setTimeout(() => el.remove(), 3200);
}

// ---------- API ----------
async function api(path, body, method) {
  const opts = method ? { method } : body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  const res = await fetch(path, opts);
  const json = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== "/api/login") { showLogin(); throw new Error(json.erro || "Entre com a senha."); }
  if (!res.ok) throw new Error(json.erro || "Erro " + res.status);
  return json;
}
// IA ligada pela chave da API ou pelo app do Claude (assinatura).
function pilulaIA() {
  const on = IA || Boolean(CLAUDEAPP?.ligado);
  $("#iaPill").classList.toggle("off", !on); $("#iaPill").lastChild.textContent = IA ? "Claude" : on ? "Claude (app)" : "Claude desligado";
}
function apply(s) {
  CLIENTES = s.clients; CAMPANHAS = s.campaigns; LOG = s.audit || []; ERROS = s.errors || {}; CONEX = s.connections || {};
  IA = Boolean(s.ia); DESKTOP = Boolean(s.desktop); PENDENTES = s.pending || []; DIAG = null;
  pilulaIA(); ATUALIZADO = s.atualizadoEm ? new Date(s.atualizadoEm) : new Date();
  if (s.usuario) { $("#uName").textContent = s.usuario; $("#uIni").textContent = s.usuario.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase(); }
  $("#logout").hidden = !s.senhaAtiva;
  $("#mockBadge").hidden = !CAMPANHAS.some((c) => c.exemplo);
  if (state.client !== "todos" && !CLIENTES.some((c) => c.id === state.client)) state.client = "todos";
  render();
}
async function load(fresh) {
  try { apply(await api(fresh ? "/api/refresh" : "/api/state", fresh ? {} : undefined)); }
  catch (e) { if (!$("#login").hidden) return; toast(e.message); }
}

function showLogin() { $("#login").hidden = false; $("#senha").focus(); }
$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try { await api("/api/login", { senha: $("#senha").value }); $("#login").hidden = true; $("#senha").value = ""; load(); }
  catch (err) { $("#loginErr").textContent = err.message; }
});
$("#logout").addEventListener("click", async () => { await api("/api/logout", {}); showLogin(); });
$("#refreshBtn").addEventListener("click", async () => { toast("Atualizando números..."); await load(true); });

// ---------- Filtros ----------
function renderFilters() {
  const f = $("#filters");
  const items = [["todos", "Todos"], ...CLIENTES.map((c) => [c.id, c.nome])];
  f.innerHTML = items.map(([id, n]) => `<button class="chip" data-c="${esc(id)}" aria-pressed="${state.client === id}">${esc(n)}</button>`).join("");
  f.hidden = state.tab === "copiloto" || state.tab === "clientes" || state.tab === "config";
  const hora = ATUALIZADO ? " · atualizado às " + ATUALIZADO.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";
  $("#ctx").innerHTML = esc(state.client === "todos" ? "Todas as lojas" : cli(state.client).nome) + `<span class="hora">${esc(hora)}</span>`;
}
$("#filters").addEventListener("click", (e) => { const b = e.target.closest("[data-c]"); if (!b) return; state.client = b.dataset.c; render(); });

// ---------- Painel ----------
function totais(list) {
  const t = list.reduce((a, c) => ({ g: a.g + c.gasto7, r: a.r + c.receita, p: a.p + c.pedidos, cl: a.cl + c.cliques }), { g: 0, r: 0, p: 0, cl: 0 });
  return { ...t, roas: t.g ? t.r / t.g : 0, cpa: t.p ? t.g / t.p : 0 };
}
function chart(list) {
  const dias = [...Array(7)].map((_, i) => new Date(Date.now() - (7 - i) * 864e5).toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", ""));
  const soma = (p) => dias.map((_, i) => list.filter((c) => c.plataforma === p).reduce((a, c) => a + (c.serie?.[i] || 0), 0));
  const meta = soma("meta"), goo = soma("google");
  const max = Math.max(50, ...meta.map((v, i) => v + goo[i]));
  const step = max > 4000 ? 2000 : max > 2000 ? 1000 : max > 800 ? 400 : max > 400 ? 200 : max > 200 ? 100 : 50;
  const top = Math.ceil(max / step) * step;
  const W = 340, H = 150, L = 44, B = 20, T = 8, cw = (W - L - 6) / 7, bw = cw * 0.56;
  const y = (v) => T + (H - T - B) * (1 - v / top);
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Gasto diário por plataforma, últimos 7 dias">`;
  for (let v = 0; v <= top; v += step) s += `<line x1="${L}" x2="${W - 4}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width="1"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${nf(v)}</text>`;
  dias.forEach((d, i) => {
    const x = L + i * cw + (cw - bw) / 2;
    s += `<rect x="${x}" y="${y(meta[i])}" width="${bw}" height="${y(0) - y(meta[i])}" fill="var(--meta)" rx="2"/>`;
    s += `<rect x="${x}" y="${y(meta[i] + goo[i])}" width="${bw}" height="${y(0) - y(goo[i])}" fill="var(--google)" rx="2"/>`;
    s += `<text x="${x + bw / 2}" y="${H - 5}" text-anchor="middle">${esc(d)}</text>`;
  });
  return s + "</svg>";
}
function alertas(list) {
  const out = [];
  for (const [p, msg] of Object.entries(ERROS)) out.push({ cls: "bad", txt: `<b>${platLabel[p]}</b>: não consegui ler as campanhas. ${esc(msg)}` });
  list.forEach((c) => {
    const k = m(c), eq = equilibrio(c);
    if (c.status === "ativa" && c.pedidos > 0 && eq && k.roas < eq) out.push({ cls: "bad", txt: `<b>${esc(c.nome)}</b> (${esc(cli(c.clientId).nome)}) está com ROAS ${dec(k.roas)}, abaixo do equilíbrio da loja (${dec(eq)}). Está dando prejuízo.`, id: c.id });
    else if (c.status === "ativa" && eq && k.roas >= eq * 1.8) out.push({ cls: "good", txt: `<b>${esc(c.nome)}</b> rende ROAS ${dec(k.roas)}. Dá para testar mais orçamento.`, id: c.id });
    else if (c.status === "ativa" && c.gasto7 > 100 && c.pedidos === 0) out.push({ cls: "bad", txt: `<b>${esc(c.nome)}</b> gastou ${brl(c.gasto7)} sem nenhum pedido medido.`, id: c.id });
    if (c.status === "em_analise") out.push({ cls: "", txt: `<b>${esc(c.nome)}</b> está em análise pela plataforma.`, id: c.id });
  });
  const lojas = new Set(list.filter((c) => c.status === "ativa").map((c) => c.clientId));
  lojas.forEach((id) => { if (!(Number(cli(id).margem) > 0)) out.push({ cls: "", txt: `<b>${esc(cli(id).nome)}</b> não tem margem cadastrada. Sem ela não dá para saber se os anúncios dão lucro.`, loja: id }); });
  const ordem = { bad: 0, "": 1, good: 2 };
  return out.sort((a, b) => ordem[a.cls] - ordem[b.cls]).slice(0, 6);
}
// Propostas criadas pelo gestor (no app ou no app do Claude) esperando o "Confirmar".
function pendentesHtml() {
  if (!PENDENTES.length) return "";
  return `<section class="card pend"><div class="cfh"><b>Aguardando sua confirmação</b><span class="stx warn">${PENDENTES.length}</span></div>
    ${PENDENTES.map((a) => `<div class="prow"><div><b>${esc(a.resumo?.titulo || a.tipo)}</b><small>${esc(a.origem || "")}${a.dados?.motivo ? " · " + esc(a.dados.motivo) : ""}${a.resumo?.custo ? " · " + esc(a.resumo.custo) : ""}</small></div><button class="btn sm pri" data-pend="${esc(a.id)}">Revisar</button></div>`).join("")}</section>`;
}
function primeirosPassos() {
  const semMargem = CLIENTES.filter((c) => !(Number(c.margem) > 0)).length;
  const passos = [
    [CONEX.google, "Conectar o Google Ads", "Client ID, Client Secret e refresh token em Configurações."],
    [CONEX.meta, "Conectar a Meta (Facebook e Instagram)", "Token de usuário do sistema em Configurações."],
    [IA || CLAUDEAPP?.ligado, "Ligar o gestor de tráfego IA", DESKTOP ? "Conecte ao app do Claude em Configurações (usa a sua assinatura)." : "Chave da Claude API em Configurações."],
    [CLIENTES.length && !semMargem, "Cadastrar a margem de cada loja", semMargem ? `${semMargem} loja${semMargem > 1 ? "s" : ""} sem margem. Sem ela o app não sabe se a campanha dá lucro.` : ""],
    [CLIENTES.some((c) => c.metaAdAccountId || c.googleCustomerId), "Ligar as contas de anúncio às lojas", "ID da conta Meta (act_...) e do cliente Google Ads em cada loja."],
  ];
  const feitos = passos.filter((p) => p[0]).length;
  if (feitos === passos.length) return "";
  let fechado = false;
  try { fechado = localStorage.getItem("tf_setup") === String(feitos); } catch (_) {}
  if (fechado) return `<button class="setup-min" data-act="setup">Primeiros passos · <span class="num">${feitos} de ${passos.length}</span> feitos</button>`;
  return `<section class="card setup"><div class="hd"><b>Primeiros passos</b><span><span class="num">${feitos} de ${passos.length}</span> <button class="btn sm" data-act="setupx" data-f="${feitos}">Ocultar</button></span></div>
    <div class="bar"><i style="width:${(feitos / passos.length) * 100}%"></i></div>
    <ol>${passos.map(([ok, t, d]) => `<li class="${ok ? "ok" : ""}"><span class="ck">${ok ? "✓" : ""}</span><div><b>${t}</b>${!ok && d ? `<small>${esc(d)}</small>` : ""}</div>${ok ? "" : t.startsWith("Cadastrar") || t.startsWith("Ligar as") ? `<button class="btn sm" data-tab="clientes">Abrir lojas</button>` : `<button class="btn sm" data-tab="config">Configurar</button>`}</li>`).join("")}</ol></section>`;
}
function tabelaLojas() {
  if (!CLIENTES.length) return `<div class="empty">Nenhuma loja cadastrada. <button class="btn sm pri" data-act="novaloja">Cadastrar loja</button></div>`;
  const rows = CLIENTES.map((c) => ({ c, r: resumoLoja(c) })).sort((a, b) => b.r.g - a.r.g);
  return `<div class="tbl-wrap desk"><table class="tbl"><thead><tr><th>Loja</th><th class="n">Investido</th><th class="n">Pedidos</th><th class="n">Custo/pedido</th><th class="n">ROAS</th><th class="n">Resultado após mídia</th><th>Saúde</th></tr></thead><tbody>
  ${rows.map(({ c, r }) => `<tr data-c="${esc(c.id)}" tabindex="0"><td><span class="dot" style="background:${esc(c.cor || "#1DB46A")}"></span><b>${esc(c.nome)}</b><small>${r.ativas} ativa${r.ativas === 1 ? "" : "s"}</small></td>
    <td class="n">${brl(r.g)}</td><td class="n">${nf(r.p)}</td>
    <td class="n">${r.p ? brl2(r.cpa) : "–"}${r.cpaMax ? `<small>máx ${brl2(r.cpaMax)}</small>` : ""}</td>
    <td class="n">${r.g ? dec(r.roas) + "×" : "–"}${r.eq ? `<small>mín ${dec(r.eq)}×</small>` : ""}</td>
    <td class="n ${r.lucro == null ? "" : r.lucro >= 0 ? "up" : "down"}">${r.lucro == null ? "–" : brl(r.lucro)}</td>
    <td>${badge(r.nivel)}</td></tr>`).join("")}
  </tbody></table></div>
  <div class="list mob">${rows.map(({ c, r }) => `<button class="client" data-c="${esc(c.id)}" style="border:0;text-align:left;width:100%"><div class="av" style="background:${esc(c.cor || "#1DB46A")}">${esc(c.nome[0])}</div><div class="info"><b>${esc(c.nome)}</b><span>${brl(r.g)} investidos · ${nf(r.p)} pedidos · ROAS ${r.g ? dec(r.roas) : "–"}${r.eq ? ` (mín ${dec(r.eq)})` : ""}</span></div><div class="r">${badge(r.nivel)}<b class="${r.lucro == null ? "" : r.lucro >= 0 ? "up" : "down"}" style="margin-top:4px">${r.lucro == null ? "–" : brl(r.lucro)}</b></div></button>`).join("")}</div>`;
}
function metasLoja(c) {
  const r = resumoLoja(c);
  if (!r.mg) return `<div class="alert"><p><b>${esc(c.nome)}</b> não tem margem cadastrada, então o app não sabe se as campanhas dão lucro.</p><button class="btn sm" data-loja="${esc(c.id)}">Cadastrar margem</button></div>`;
  return `<div class="metas">
    <div><span>Margem de contribuição</span><b>${dec(r.mg * 100, 0)}%</b></div>
    <div><span>ROAS mínimo (equilíbrio)</span><b>${dec(r.eq)}×</b></div>
    <div><span>Custo máximo por 1º pedido</span><b>${r.cpaMax ? brl2(r.cpaMax) : "cadastre o ticket"}</b></div>
    <div><span>Saúde da semana</span>${badge(r.nivel)}</div></div>`;
}
function viewPainel() {
  const list = visiveis(), t = totais(list), al = alertas(list);
  const lojas = state.client === "todos" ? CLIENTES : [cli(state.client)];
  const comMargem = lojas.filter((c) => Number(c.margem) > 0);
  const lucro = comMargem.length ? comMargem.reduce((a, c) => { const cs = list.filter((x) => x.clientId === c.id), tt = totais(cs); return a + tt.r * (c.margem / 100) - tt.g; }, 0) : null;
  const eqAll = state.client !== "todos" ? equilibrio({ clientId: state.client }) : null;
  return `${pendentesHtml()}${primeirosPassos()}
  <div class="kpis k5">
    <div class="kpi" data-help="gasto"><div class="l">Investido · 7 dias ⓘ</div><div class="v">${brl(t.g)}</div><div class="d">${list.filter((c) => c.status === "ativa").length} campanhas ativas</div></div>
    <div class="kpi" data-help="receita"><div class="l">Receita atribuída ⓘ</div><div class="v">${brl(t.r)}</div><div class="d">${list.some((c) => c.receitaEstimada) ? "parte estimada pelo ticket" : "medida pela plataforma"}</div></div>
    <div class="kpi" data-help="pedidos"><div class="l">Pedidos ⓘ</div><div class="v">${nf(t.p)}</div><div class="d">Custo/pedido ${brl2(t.cpa)}</div></div>
    <div class="kpi" data-help="roas"><div class="l">ROAS ⓘ</div><div class="v">${dec(t.roas)}×</div><div class="d">${eqAll ? `mínimo da loja ${dec(eqAll)}×` : `${nf(t.cl)} cliques`}</div></div>
    <div class="kpi" data-help="lucro"><div class="l">Resultado após mídia ⓘ</div><div class="v ${lucro == null ? "" : lucro >= 0 ? "up" : "down"}">${lucro == null ? "–" : brl(lucro)}</div><div class="d">${lucro == null ? "cadastre a margem das lojas" : comMargem.length < lojas.length ? `${comMargem.length} de ${lojas.length} lojas com margem` : "margem − investimento"}</div></div>
  </div>
  <div class="duo">
    <div class="chartcard">
      <div class="hd"><span>Gasto por dia (R$)</span><span class="legend"><span><i style="background:var(--meta)"></i>Meta</span><span><i style="background:var(--google)"></i>Google</span></span></div>
      ${chart(list)}
    </div>
    <section><h2 class="first">Precisa de atenção ${al.length ? `<span class="count">${al.length}</span>` : ""}</h2>
    <div class="alerts">${al.length ? al.map((a) => `<div class="alert ${a.cls}"><span class="ico">${a.cls === "bad" ? "!" : a.cls === "good" ? "↑" : "i"}</span><p>${a.txt}</p>${a.id ? `<button class="btn sm" data-ask="O que eu faço com a campanha ${esc(camp(a.id)?.nome)}?">O que faço?</button>` : a.loja ? `<button class="btn sm" data-loja="${esc(a.loja)}">Cadastrar</button>` : ""}</div>`).join("") : `<div class="empty">Tudo dentro do esperado nos últimos 7 dias.</div>`}</div></section>
  </div>
  ${state.client === "todos" ? `<h2>Saúde das lojas</h2>${tabelaLojas()}` : `<h2>Metas da loja</h2>${metasLoja(cli(state.client))}`}
  <h2>Ações rápidas</h2>
  <div class="row"><button class="btn pri" data-act="nova">Nova campanha</button><button class="btn" data-ask="Faz um diagnóstico da semana e me diz o que fazer hoje">Diagnóstico da semana</button><button class="btn" data-act="relatorio">Relatório do cliente</button></div>
  ${LOG.length ? `<h2>Últimas alterações</h2><div class="list">${LOG.slice(0, 6).map((l) => `<div class="alert ${l.resultado === "falhou" ? "bad" : "good"}"><p>${esc(l.resultado === "falhou" ? "Falhou: " + l.detalhe : l.resultado)}<br><small style="color:var(--muted)">${esc(l.quem || "")} · ${esc(l.origem || "")} · ${new Date(l.at).toLocaleString("pt-BR")}</small></p></div>`).join("")}</div>` : ""}`;
}

// ---------- Campanhas ----------
function campCard(c) {
  const k = m(c);
  return `
  <button class="camp" data-open="${esc(c.id)}">
    <span class="n">${esc(c.nome)}</span><span class="row" style="gap:6px;flex-wrap:nowrap">${c.status === "ativa" ? badge(saudeCamp(c)) : ""}<span class="st ${stClass[c.status]}">${stLabel[c.status]}</span></span>
    <span class="meta"><span class="tag ${c.plataforma}">${platLabel[c.plataforma]}</span>${esc(c.canal)} · ${esc(cli(c.clientId).nome)} · <span class="num">${c.orcamento != null ? brl(c.orcamento) + "/dia" : "orçamento no conjunto"}</span></span>
    <span class="stats"><div><span>Gasto 7d</span><b>${brl(c.gasto7)}</b></div><div><span>Pedidos</span><b>${nf(c.pedidos)}</b></div><div><span>Custo/ped.</span><b>${c.pedidos ? brl2(k.cpa) : "–"}</b></div><div><span>ROAS</span><b>${c.gasto7 ? dec(k.roas) : "–"}</b></div></span>
  </button>`;
}
const COLS = [
  ["nome", "Campanha"], ["loja", "Loja"], ["status", "Status"], ["orcamento", "Orçamento/dia", 1], ["gasto7", "Gasto 7d", 1],
  ["pedidos", "Pedidos", 1], ["cpa", "Custo/pedido", 1], ["roas", "ROAS", 1], ["saude", "Saúde"],
];
const sortVal = (c, k) => ({ loja: cli(c.clientId).nome, cpa: m(c).cpa || Infinity, roas: m(c).roas, saude: ["ruim", "limite", "semmargem", "semdado", "bom"].indexOf(saudeCamp(c)) }[k] ?? c[k] ?? "");
const saudeCamp = (c) => (c.status !== "ativa" && !c.gasto7 ? "semdado" : saude(m(c).roas, c.gasto7, c.pedidos, equilibrio(c)));
function campFiltradas() {
  const q = state.q.trim().toLowerCase(), { k, dir } = state.sort;
  return visiveis()
    .filter((c) => (state.st === "todas" || c.status === state.st) && (!q || (c.nome + " " + cli(c.clientId).nome + " " + c.canal).toLowerCase().includes(q)))
    .sort((a, b) => { const x = sortVal(a, k), y = sortVal(b, k); return (typeof x === "string" ? x.localeCompare(y, "pt-BR") : x - y) * dir; });
}
function campTabela(list) {
  if (!list.length) return `<div class="empty">Nenhuma campanha com esses filtros.</div>`;
  const { k, dir } = state.sort;
  return `<div class="tbl-wrap desk"><table class="tbl"><thead><tr>${COLS.map(([key, t, n]) => `<th class="${n ? "n" : ""}"><button data-sort="${key}" aria-sort="${k === key ? (dir > 0 ? "ascending" : "descending") : "none"}">${t}${k === key ? (dir > 0 ? " ↑" : " ↓") : ""}</button></th>`).join("")}</tr></thead><tbody>
  ${list.map((c) => { const x = m(c), eq = equilibrio(c); return `<tr data-open="${esc(c.id)}" tabindex="0">
    <td><b>${esc(c.nome)}</b><small><span class="tag ${c.plataforma}">${platLabel[c.plataforma]}</span> ${esc(c.canal)}</small></td>
    <td><span class="dot" style="background:${esc(cli(c.clientId).cor || "#1DB46A")}"></span>${esc(cli(c.clientId).nome)}</td>
    <td><span class="st ${stClass[c.status]}">${stLabel[c.status]}</span></td>
    <td class="n">${c.orcamento != null ? brl(c.orcamento) : "no conjunto"}</td>
    <td class="n">${brl(c.gasto7)}</td><td class="n">${nf(c.pedidos)}</td>
    <td class="n">${c.pedidos ? brl2(x.cpa) : "–"}</td>
    <td class="n">${c.gasto7 ? dec(x.roas) + "×" : "–"}${eq ? `<small>mín ${dec(eq)}×</small>` : ""}</td>
    <td>${badge(saudeCamp(c))}</td></tr>`; }).join("")}
  </tbody></table></div>
  <div class="list mob">${list.map(campCard).join("")}</div>`;
}
function viewCampanhas() {
  const base = visiveis(), cnt = (st) => base.filter((c) => st === "todas" || c.status === st).length;
  return `<div class="toolbar">
    <input id="busca" type="search" placeholder="Buscar campanha ou loja" value="${esc(state.q)}" aria-label="Buscar campanha">
    <div class="row">${["todas", "meta", "google"].map((p) => `<button class="chip" data-plat="${p}" aria-pressed="${state.plat === p}">${p === "todas" ? "Meta + Google" : platLabel[p]}</button>`).join("")}</div>
    <div class="row">${[["todas", "Todas"], ["ativa", "Ativas"], ["pausada", "Pausadas"], ["em_analise", "Em análise"]].map(([v, t]) => `<button class="chip" data-st="${v}" aria-pressed="${state.st === v}">${t} <span class="num">${cnt(v)}</span></button>`).join("")}</div>
    <button class="btn pri sm" data-act="nova" style="margin-left:auto">+ Nova campanha</button></div>
  <div id="campList">${campTabela(campFiltradas())}</div>`;
}
$("#view").addEventListener("input", (e) => { if (e.target.id === "busca") { state.q = e.target.value; $("#campList").innerHTML = campTabela(campFiltradas()); } });
$("#view").addEventListener("keydown", (e) => { const tr = e.target.closest("tr[data-open],tr[data-c]"); if (tr && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); tr.click(); } });

// ---------- Lojas e contas ----------
function viewClientes() {
  return `<div class="row" style="justify-content:space-between;align-items:center"><h2 style="margin:0">Restaurantes atendidos</h2><button class="btn pri sm" data-loja="">+ Loja</button></div>
  <div class="clients" style="margin-top:10px">${CLIENTES.map((c) => {
    const r = resumoLoja(c), n = r.ativas;
    return `<button class="client" data-loja="${esc(c.id)}" style="border:0;text-align:left;width:100%"><div class="av" style="background:${esc(c.cor || "#1DB46A")}">${esc(c.nome[0])}</div><div class="info"><b>${esc(c.nome)} ${badge(r.nivel)}</b><span>${esc(c.cidade)} · ${n} ativa${n === 1 ? "" : "s"} · ${r.mg ? `margem ${dec(r.mg * 100, 0)}% · ROAS mín ${dec(r.eq)}×` : "sem margem"} · ${c.metaAdAccountId ? "Meta ✓" : "sem Meta"} · ${c.googleCustomerId ? "Google ✓" : "sem Google"}</span></div><div class="r"><b>${brl(r.g)}</b>ROAS ${dec(r.roas)}</div></button>`;
  }).join("")}</div>
  <h2>Contas conectadas</h2>
  <div class="list">
    <div class="conn"><div class="h"><span class="tag meta">Meta</span> Facebook e Instagram <span class="st ${CONEX.meta ? "ativa" : "pausada"}" style="margin-left:auto">${CONEX.meta ? "Conectado" : "Modo exemplo"}</span></div>
      ${CONEX.meta ? `<div class="sub" style="margin:0">Cadastre o ID da conta de anúncio (act_...) em cada loja.</div>` : `<div class="row" style="align-items:center"><span class="sub" style="margin:0;flex:1">Coloque o token da Meta em Configurações.</span><button class="btn sm" data-tab="config">Configurar</button></div>`}</div>
    <div class="conn"><div class="h"><span class="tag google">Google</span> Google Ads <span class="st ${CONEX.google ? "ativa" : "pausada"}" style="margin-left:auto">${CONEX.google ? "Conectado" : "Modo exemplo"}</span></div>
      ${CONEX.google ? `<div class="sub" style="margin:0">Cadastre o ID de cliente Google Ads (123-456-7890) em cada loja.</div>` : `<div class="row" style="align-items:center"><span class="sub" style="margin:0;flex:1">Coloque as chaves do Google Ads em Configurações.</span><button class="btn sm" data-tab="config">Configurar</button></div>`}</div>
  </div>`;
}
const CORES = ["#1DB46A","#0E7C66","#2F80ED","#7B61FF","#E8505B","#F2994A","#F2C94C","#8D6E63"];
function editarLoja(id) {
  const c = CLIENTES.find((x) => x.id === id) || {};
  let cor = c.cor || CORES[CLIENTES.length % CORES.length];
  sheet(`<h3>${c.id ? "Editar loja" : "Nova loja"}</h3>
    <p class="sub" style="margin:-4px 0 8px">${c.id ? "Dados usados nos cálculos de ROAS mínimo e custo máximo por pedido." : "Cadastre o restaurante e as contas de anúncio dele."}</p>
    <div class="field"><label for="lj-nome">Nome</label><input id="lj-nome" value="${esc(c.nome || "")}"></div>
    <div class="grid2"><div class="field"><label for="lj-cid">Cidade / bairro</label><input id="lj-cid" value="${esc(c.cidade || "")}"></div>
    <div class="field"><label for="lj-tk">Ticket médio (R$)</label><input id="lj-tk" type="number" inputmode="decimal" value="${esc(c.ticket || "")}"></div></div>
    <div class="field"><label for="lj-mg">Margem de contribuição antes da mídia (%)</label><input id="lj-mg" type="number" inputmode="decimal" placeholder="ex.: 28" value="${esc(c.margem || "")}"><span class="sub" style="margin:0">O que sobra do pedido depois de CMV, embalagem, taxas, entrega e impostos. Define o ROAS mínimo da loja.</span></div>
    <div class="field"><label for="lj-meta">Conta de anúncio Meta</label><input id="lj-meta" placeholder="act_1234567890" value="${esc(c.metaAdAccountId || "")}"></div>
    <div class="field"><label for="lj-goo">ID de cliente Google Ads</label><input id="lj-goo" placeholder="123-456-7890" value="${esc(c.googleCustomerId || "")}"></div>
    <div class="field"><label>Cor de identificação</label><div class="cores" id="lj-cor">${CORES.map((k) => `<button type="button" class="cor" data-cor="${k}" style="background:${k}" aria-label="Cor ${k}" aria-pressed="${k === cor}"></button>`).join("")}</div></div>
    <div class="row"><button class="btn pri" id="lj-ok">${c.id ? "Salvar alterações" : "Cadastrar loja"}</button><button class="btn" id="lj-x">Cancelar</button>${c.id ? `<button class="btn danger" id="lj-del" style="margin-left:auto">Excluir</button>` : ""}</div>`, (s) => {
    s.querySelector("#lj-x").onclick = closeSheet;
    s.querySelector("#lj-cor").onclick = (e) => {
      const b = e.target.closest("[data-cor]");
      if (!b) return;
      cor = b.dataset.cor;
      s.querySelectorAll("#lj-cor .cor").forEach((x) => x.setAttribute("aria-pressed", x === b));
    };
    const del = s.querySelector("#lj-del");
    if (del) del.onclick = async () => {
      if (!del.dataset.sure) { del.dataset.sure = "1"; del.textContent = "Toque de novo para excluir"; return; }
      try { await api(`/api/clients/${encodeURIComponent(c.id)}`, null, "DELETE"); closeSheet(); toast("Loja excluída do TrafgFood"); if (state.client === c.id) state.client = "todos"; load(true); }
      catch (e) { toast(e.message); }
    };
    s.querySelector("#lj-ok").onclick = async () => {
      const v = (q) => s.querySelector(q).value;
      try {
        await api("/api/clients", { id: c.id, nome: v("#lj-nome"), cidade: v("#lj-cid"), ticket: v("#lj-tk"), margem: v("#lj-mg"), metaAdAccountId: v("#lj-meta"), googleCustomerId: v("#lj-goo"), cor });
        closeSheet(); toast(c.id ? "Loja salva" : "Loja cadastrada"); load(true);
      } catch (e) { toast(e.message); }
    };
  });
}


// ---------- Configurações ----------
async function carregarClaudeApp() {
  try { CLAUDEAPP = await api("/api/claude-app"); pilulaIA(); render(); } catch (_) { CLAUDEAPP = { instalado: false, ligado: false }; }
}
async function conectarClaudeApp() {
  try {
    const r = await api("/api/claude-app/conectar", {});
    CLAUDEAPP = r; pilulaIA();
    sheet(`<h3>TrafgFood conectado ao app do Claude</h3><p style="margin:0">Falta só isto:</p><ol style="margin:0;padding-left:20px;line-height:1.7"><li>Feche o app do Claude por completo: clique com o botão direito no ícone do Claude perto do relógio e escolha <b>Sair</b>.</li><li>Abra o app do Claude de novo.</li><li>Escreva: <i>"Use o TrafgFood e me diga o que fazer hoje nas campanhas."</i></li><li>Quando o Claude pedir permissão para usar o TrafgFood, clique em <b>Permitir</b>.</li></ol><p class="sub" style="margin:0">O que o Claude sugerir aparece no Painel, em "Aguardando sua confirmação".</p><div class="row"><button class="btn pri" id="okc">Entendi</button></div>`, (s) => { s.querySelector("#okc").onclick = closeSheet; });
    render();
  } catch (e) { toast(e.message); }
}
async function loadConfig() {
  try { CONFIG = await api("/api/config"); } catch (e) { CONFIG = []; toast(e.message); }
  if (state.tab === "config") render();
}
function statusGrupo(g) {
  const algum = g.campos.some((c) => c.salvo || c.valor);
  if (g.id === "acesso") return ["ok", g.campos.find((c) => c.key === "APP_PASSWORD")?.salvo ? "Senha ativa" : "Sem senha"];
  if (g.teste?.ok) return ["ok", "Conectado"];
  if (g.teste) return ["bad", "Com erro"];
  if ((g.id === "google" && CONEX.google) || (g.id === "meta" && CONEX.meta) || (g.id === "claude" && IA)) return ["warn", "Salvo, falta testar"];
  return ["off", algum ? "Incompleto" : "Não conectado"];
}
function campoHtml(c) {
  const ph = c.secret ? (c.salvo ? `Salvo (final ${c.final}). Cole outro para trocar.` : c.placeholder) : c.placeholder;
  return `<div class="field"><label for="cf-${c.key}">${esc(c.label)}${c.origem === "servidor" ? ` <span class="sub" style="font-weight:400">· vem do servidor</span>` : ""}</label>
    <div class="cfin"><input id="cf-${c.key}" data-key="${c.key}" ${c.secret ? `type="password" autocomplete="new-password" data-secret="1"` : `type="text"`} spellcheck="false" placeholder="${esc(ph)}" value="${c.secret ? "" : esc(c.valor || "")}">
    ${c.secret && c.salvo && c.origem === "app" ? `<button class="btn sm" data-limpar="${c.key}" title="Apagar este valor">Apagar</button>` : ""}</div></div>`;
}
function viewConfig() {
  if (!CONFIG) { loadConfig(); return `<div class="empty">Carregando...</div>`; }
  if (!CLAUDEAPP && DESKTOP) carregarClaudeApp();
  return `<p class="sub" style="margin:0 0 12px">As chaves ficam guardadas só ${DESKTOP ? "neste computador" : "no servidor do TrafgFood"} e nunca aparecem de novo na tela. Para trocar um segredo, cole o novo por cima.</p>
  <div class="cfgs">${CONFIG.map((g) => { const [cls, txt] = statusGrupo(g); return `<section class="card cfg" data-grupo="${g.id}">
    <div class="cfh"><b>${esc(g.titulo)}</b><span class="stx ${cls}">${txt}</span></div>
    <p class="sub" style="margin:0">${esc(g.ajuda)}</p>
    ${g.teste ? `<p class="tmsg ${g.teste.ok ? "ok" : "bad"}">Último teste: ${esc(g.teste.msg)}</p>` : ""}
    ${g.campos.map(campoHtml).join("")}
    ${g.id === "google" ? `<div class="oauth"><b>Refresh token sem complicação</b><span>1. Salve o Client ID e o Client Secret. 2. No Google Cloud, em Credenciais, abra o seu Client ID e adicione em "URIs de redirecionamento autorizados" este endereço:</span>
      <div class="cfin"><input readonly value="${esc(location.origin)}/api/google/callback" id="cbUrl"><button class="btn sm" data-copiar="cbUrl">Copiar</button></div>
      <span>3. Clique em Conectar com Google e entre com a conta que administra a MCC. O TrafgFood guarda o refresh token sozinho.</span>
      <a class="btn sm pri" href="/api/google/conectar" style="align-self:flex-start;text-decoration:none">Conectar com Google</a></div>` : ""}
    <div class="row"><button class="btn pri sm" data-salvar="${g.id}">Salvar</button>${g.id !== "acesso" ? `<button class="btn sm" data-testar="${g.id}">Testar conexão</button>` : ""}</div>
  </section>`; }).join("")}</div>
  ${DESKTOP ? `<section class="card cfg" style="margin-top:12px"><div class="cfh"><b>App do Claude (sua assinatura)</b><span class="stx ${CLAUDEAPP?.ligado ? "ok" : "off"}">${CLAUDEAPP?.ligado ? "Conectado" : CLAUDEAPP?.instalado ? "Não conectado" : "App do Claude não encontrado"}</span></div>
    <p class="sub" style="margin:0">Usa a assinatura do Claude que você já paga, sem chave de API. O app do Claude lê as campanhas do TrafgFood e deixa as mudanças aqui para você confirmar. Precisa do app do Claude para computador (claude.ai/download) instalado e com a sua conta.</p>
    <div class="row"><button class="btn pri sm" data-act="claudeapp">${CLAUDEAPP?.ligado ? "Conectar de novo" : "Conectar ao app do Claude"}</button></div></section>` : ""}
  ${DESKTOP ? `<section class="card cfg" style="margin-top:12px"><div class="cfh"><b>Programa</b></div><p class="sub" style="margin:0">O TrafgFood fica ligado em segundo plano. Para abrir de novo, use o ícone TrafgFood na área de trabalho ou no menu Iniciar.</p><div class="row"><button class="btn dng sm" data-act="desligar">Desligar o TrafgFood</button></div></section>` : ""}`;
}
async function salvarGrupo(id) {
  const sec = document.querySelector(`[data-grupo="${id}"]`), patch = {};
  sec.querySelectorAll("input[data-key]").forEach((i) => { if (!i.dataset.secret || i.value.trim()) patch[i.dataset.key] = i.value.trim(); });
  try {
    CONFIG = await api("/api/config", patch);
    toast("Salvo");
    await load(true);
    if (id !== "acesso" && CONFIG.find((g) => g.id === id).campos.some((c) => c.salvo || c.valor)) return testarGrupo(id);
    render();
  } catch (e) { toast(e.message); }
}
async function testarGrupo(id) {
  const b = document.querySelector(`[data-testar="${id}"]`);
  if (b) { b.disabled = true; b.textContent = "Testando..."; }
  try { await api(`/api/config/test/${id}`, {}); } catch (e) { toast(e.message); }
  CONFIG = await api("/api/config"); await load(true);
}

// ---------- Sheets e confirmação ----------
function sheet(html, onMount) {
  const root = $("#sheetRoot");
  root.innerHTML = `<div class="scrim" id="scrim"><div class="sheet" role="dialog" aria-modal="true">${html}</div></div>`;
  $("#scrim").addEventListener("click", (e) => { if (e.target.id === "scrim") closeSheet(); });
  onMount && onMount(root.querySelector(".sheet"));
}
function closeSheet() { $("#sheetRoot").innerHTML = ""; }

// Mostra a proposta (o que muda e quanto custa) e só aplica no "Confirmar".
function confirmar(action) {
  const r = action.resumo;
  return new Promise((res) => {
    sheet(`<h3>${esc(r.titulo)}</h3>${action.origem === "gestor IA" ? `<div class="sub">Proposto pelo gestor IA${action.dados?.motivo ? ": " + esc(action.dados.motivo) : ""}</div>` : ""}
      <dl class="diff">${r.linhas.map(([a, b]) => `<dt>${esc(a)}</dt><dd>${esc(b)}</dd>`).join("")}</dl>
      ${r.custo ? `<div class="money">${esc(r.custo)}</div>` : ""}
      <div class="row"><button class="btn ${r.perigo ? "dng" : "pri"}" id="ok">Confirmar</button><button class="btn" id="no">Cancelar</button></div>`, (s) => {
      const ok = s.querySelector("#ok");
      ok.onclick = async () => {
        ok.disabled = true; ok.textContent = "Aplicando...";
        try { const out = await api(`/api/actions/${action.id}/confirm`, {}); closeSheet(); toast(out.resultado); load(); res({ confirmado: true, resultado: out.resultado }); }
        catch (e) { closeSheet(); toast(e.message); load(); res({ confirmado: false, erro: e.message }); }
      };
      s.querySelector("#no").onclick = () => { api(`/api/actions/${action.id}/reject`, {}).catch(() => {}); closeSheet(); res({ confirmado: false }); };
      ok.focus();
    });
  });
}
async function propor(payload) {
  try { return await confirmar(await api("/api/actions", payload)); }
  catch (e) { toast(e.message); }
}

function abrirCampanha(id) {
  const c = camp(id), k = m(c);
  sheet(`<h3>${esc(c.nome)}</h3><div class="sub"><span class="tag ${c.plataforma}">${platLabel[c.plataforma]}</span> ${esc(c.canal)} · ${esc(cli(c.clientId).nome)} · <span class="st ${stClass[c.status]}">${stLabel[c.status]}</span></div>
    <div class="kpis">
      <div class="kpi" style="background:var(--bg)"><div class="l">Gasto 7d</div><div class="v">${brl(c.gasto7)}</div></div>
      <div class="kpi" style="background:var(--bg)"><div class="l">Pedidos</div><div class="v">${nf(c.pedidos)}</div></div>
      <div class="kpi" style="background:var(--bg)"><div class="l">CTR · CPC</div><div class="v" style="font-size:16px">${dec(k.ctr, 2)}% · ${brl2(k.cpc)}</div></div>
      <div class="kpi" style="background:var(--bg)"><div class="l">ROAS</div><div class="v">${c.gasto7 ? dec(k.roas) + "×" : "–"}</div></div>
    </div>
    ${c.orcamento != null ? `<div class="field"><label for="budget">Orçamento diário (R$)</label><input id="budget" type="number" inputmode="numeric" min="6" step="5" value="${c.orcamento}"></div>` : `<div class="sub">O orçamento desta campanha fica no conjunto de anúncios. Ajuste direto na plataforma.</div>`}
    <div class="row">
      ${c.orcamento != null ? `<button class="btn pri" id="saveB">Salvar orçamento</button>` : ""}
      ${c.status === "ativa" ? `<button class="btn dng" id="tog">Pausar</button>` : c.status === "pausada" ? `<button class="btn" id="tog">Reativar</button>` : ""}
      <button class="btn" id="ask">Perguntar ao gestor IA</button>
    </div>`, (s) => {
    s.querySelector("#saveB") && (s.querySelector("#saveB").onclick = () => { const v = Number(s.querySelector("#budget").value); if (v === c.orcamento) return closeSheet(); propor({ tipo: "orcamento", campanhaId: c.id, dados: { orcamento: v } }); });
    s.querySelector("#tog") && (s.querySelector("#tog").onclick = () => propor({ tipo: c.status === "ativa" ? "pausar" : "ativar", campanhaId: c.id }));
    s.querySelector("#ask").onclick = () => { closeSheet(); perguntar(`O que eu faço com a campanha ${c.nome} (${cli(c.clientId).nome})?`); };
  });
}

function novaCampanha() {
  const cid = state.client !== "todos" ? state.client : CLIENTES[0]?.id;
  if (!cid) return toast("Cadastre uma loja primeiro.");
  sheet(`<h3>Nova campanha</h3><div class="sub">Nasce pausada na plataforma; nada é gasto até você ativar.</div>
    <div class="field"><label for="nc-cli">Loja</label><select id="nc-cli">${CLIENTES.map((c) => `<option value="${esc(c.id)}" ${c.id === cid ? "selected" : ""}>${esc(c.nome)}</option>`).join("")}</select></div>
    <div class="grid2">
      <div class="field"><label for="nc-plat">Plataforma</label><select id="nc-plat"><option value="meta">Meta (FB + IG)</option><option value="google">Google Ads</option></select></div>
      <div class="field"><label for="nc-canal">Formato</label><select id="nc-canal"></select></div>
    </div>
    <div class="field"><label for="nc-nome">Nome</label><input id="nc-nome" value="Promo fim de semana"></div>
    <div class="field"><label for="nc-obj">Objetivo</label><select id="nc-obj"><option>Pedidos no WhatsApp</option><option>Pedidos no iFood</option><option>Pedidos no site</option><option>Mensagens</option><option>Cadastro (lead)</option><option>Alcance local</option></select></div>
    <div class="grid2">
      <div class="field"><label for="nc-raio">Raio de entrega (km)</label><input id="nc-raio" type="number" inputmode="numeric" value="5" min="1" max="40"></div>
      <div class="field"><label for="nc-orc">Orçamento/dia (R$)</label><input id="nc-orc" type="number" inputmode="numeric" value="40" min="6" step="5"></div>
    </div>
    <div class="field"><label for="nc-pub">Público</label><input id="nc-pub" value="18 a 55 anos, segmentação aberta no raio de entrega"></div>
    <div class="row"><button class="btn pri" id="nc-ok">Revisar e criar</button><button class="btn" id="nc-ai">Pedir para o gestor IA montar</button><button class="btn" id="nc-x">Cancelar</button></div>`, (s) => {
    const canais = { meta: ["Instagram + Facebook", "Instagram", "Facebook"], google: ["Pesquisa", "Performance Max", "Display"] };
    const fill = () => { s.querySelector("#nc-canal").innerHTML = canais[s.querySelector("#nc-plat").value].map((x) => `<option>${x}</option>`).join(""); };
    fill();
    s.querySelector("#nc-plat").onchange = fill;
    s.querySelector("#nc-x").onclick = closeSheet;
    const v = (q) => s.querySelector(q).value;
    s.querySelector("#nc-ai").onclick = () => { const nome = cli(v("#nc-cli")).nome; closeSheet(); perguntar(`Monta a melhor campanha para a ${nome} com até ${brl(v("#nc-orc"))} por dia.`); };
    s.querySelector("#nc-ok").onclick = () => propor({ tipo: "criar", dados: { clientId: v("#nc-cli"), plataforma: v("#nc-plat"), canal: v("#nc-canal"), nome: v("#nc-nome"), objetivo: v("#nc-obj"), raio: v("#nc-raio"), orcamento: v("#nc-orc"), publico: v("#nc-pub") } });
  });
}

function relatorio() {
  const c0 = state.client === "todos" ? null : cli(state.client), list = visiveis(), t = totais(list);
  const melhor = [...list].filter((c) => c.gasto7).sort((a, b) => m(b).roas - m(a).roas)[0];
  const txt = `Relatório semanal · ${c0 ? c0.nome : "todas as lojas"}\n\nInvestimento: ${brl(t.g)}\nPedidos: ${nf(t.p)} (custo por pedido ${brl2(t.cpa)})\nReceita atribuída: ${brl(t.r)}\nROAS: ${dec(t.roas)}×\n${melhor ? `\nMelhor campanha: ${melhor.nome} (ROAS ${dec(m(melhor).roas)})` : ""}`;
  sheet(`<h3>Relatório pronto</h3><div class="sub">Copie e mande no WhatsApp do cliente.</div><textarea id="rep" rows="10" style="border:1px solid var(--line);background:var(--bg);border-radius:11px;padding:10px 12px;width:100%">${esc(txt)}</textarea><div class="row"><button class="btn pri" id="cp">Copiar</button><button class="btn" id="cx">Fechar</button></div>`, (s) => {
    s.querySelector("#cx").onclick = closeSheet;
    s.querySelector("#cp").onclick = () => navigator.clipboard.writeText(txt).then(() => toast("Relatório copiado")).catch(() => { const r = s.querySelector("#rep"); r.focus(); r.select(); });
  });
}

const AJUDA = {
  lucro: ["Resultado após mídia", "Quanto sobrou para a loja depois de pagar os anúncios: receita × margem de contribuição − investimento. Positivo quer dizer que o tráfego deu lucro na semana. Só aparece para lojas com margem cadastrada."],
  gasto: ["Investido", "Quanto saiu do cartão em anúncios nos últimos 7 dias, somando Meta e Google."],
  receita: ["Receita atribuída", "Valor dos pedidos que vieram de quem clicou num anúncio. Quando a plataforma não mede vendas, o TrafgFood estima com pedidos × ticket médio da loja. Confira com o caixa."],
  pedidos: ["Pedidos e custo por pedido", "Quantos pedidos os anúncios trouxeram. O custo por pedido é o gasto dividido pelos pedidos; para delivery, o teto é o CPA máximo da loja: ticket médio × margem de contribuição, mais a recompra esperada."],
  roas: ["ROAS", "Quantos reais voltam para cada real investido. ROAS 5 quer dizer que R$ 100 em anúncio trouxeram R$ 500 em pedidos. O mínimo de cada loja é o ROAS de equilíbrio = 1 ÷ margem: com margem de 25%, precisa de ROAS 4 só para empatar. Cadastre a margem em Lojas e contas."],
};
function ajuda(k) { const [t, d] = AJUDA[k]; sheet(`<h3>${t}</h3><p style="margin:0">${d}</p><div class="row"><button class="btn" id="hx">Entendi</button></div>`, (s) => { s.querySelector("#hx").onclick = closeSheet; }); }

// ---------- Gestor de tráfego IA ----------
let turns = [], busy = false;
const chatLog = [{ r: "sys", t: "Sou seu gestor de tráfego. Me diga o que quer, por voz ou texto, que eu recomendo a estratégia e explico em linguagem simples. Tudo que mexe em dinheiro chega para você confirmar antes." }];
function viewCopiloto() {
  if (!DIAG) { api("/api/diagnostico").then((d) => { DIAG = d; if (state.tab === "copiloto") render(); }).catch((e) => toast(e.message)); }
  const cls = { grave: "bad", atencao: "", oportunidade: "good" }, ic = { grave: "!", atencao: "i", oportunidade: "↑" };
  const diag = !DIAG ? `<div class="empty">Analisando as campanhas...</div>` : DIAG.itens.length ? DIAG.itens.map((d) => `<div class="dg ${cls[d.nivel]}">
      <div class="dgh"><span class="ico">${ic[d.nivel]}</span><b>${esc(d.titulo)}</b>${d.loja ? `<small>${esc(d.loja)}</small>` : ""}</div>
      <p>${esc(d.porque)}</p>
      ${d.verificar?.length ? `<details><summary>O que verificar</summary><ul>${d.verificar.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></details>` : ""}
      <ul class="acoes">${d.acoes.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
      <div class="row">${d.proposta ? `<button class="btn sm ${d.nivel === "oportunidade" ? "pri" : "dng"}" data-diag="${esc(JSON.stringify({ c: d.campanhaId, ...d.proposta }))}">${esc(d.proposta.rotulo)}</button>` : ""}${d.lojaId && !d.campanhaId ? `<button class="btn sm" data-loja="${esc(d.lojaId)}">Abrir loja</button>` : ""}${d.campanhaId ? `<button class="btn sm" data-open="${esc(d.campanhaId)}">Ver campanha</button>` : ""}</div>
    </div>`).join("") : `<div class="empty">Nenhum problema pelas regras da base. Siga a rotina abaixo.</div>`;
  const rot = DIAG?.rotina ? `<details class="card rot"><summary><b>Rotina de otimização</b></summary>${[["diaria", "Todo dia"], ["semanal", "Toda semana"], ["mensal", "Todo mês"]].map(([k, t]) => `<p><b>${t}:</b> ${esc(DIAG.rotina[k].join(", "))}.</p>`).join("")}</details>` : "";
  const conversa = IA ? `<h2>Conversar com o gestor IA</h2><div class="chat" id="chat">${chatLog.map((x) => `<div class="msg ${x.r}">${esc(x.t)}</div>`).join("")}
    ${chatLog.length < 2 ? `<div class="suggest">${["O que eu devo fazer hoje nas campanhas?", "Qual campanha está dando prejuízo?", "Monta um plano de R$ 1.500 por mês para uma loja nova", "Me explica o que é ROAS"].map((x) => `<button class="chip" data-say="${esc(x)}">${esc(x)}</button>`).join("")}</div>` : ""}</div>`
    : `<section class="card cfg" style="margin-top:16px"><div class="cfh"><b>Conversar com o gestor IA</b>${CLAUDEAPP?.ligado ? `<span class="stx ok">Pelo app do Claude</span>` : ""}</div>
      ${DESKTOP ? `<p class="sub" style="margin:0">Converse pelo app do Claude, com a sua assinatura, sem custo extra. Ele lê as campanhas do TrafgFood, segue a base da Delivefood e deixa as mudanças aqui para você confirmar.</p>
      ${CLAUDEAPP?.ligado ? `<p class="sub" style="margin:0">Abra o app do Claude e escreva, por exemplo: <i>"Use o TrafgFood e me diga o que fazer hoje nas campanhas."</i></p>` : `<div class="row"><button class="btn pri sm" data-act="claudeapp">Conectar ao app do Claude</button></div>`}`
      : `<p class="sub" style="margin:0">Para conversar por texto e voz aqui, coloque a chave da Claude API em Configurações.</p>`}</section>`;
  return `<h2 class="first" style="margin-top:4px">Diagnóstico da semana <span class="sub" style="font-weight:400">· regras da Base Delivefood, sem IA</span></h2><div class="dgs">${diag}</div>${rot}${conversa}`;
}
function pushMsg(r, t) {
  chatLog.push({ r, t });
  if (state.tab !== "copiloto") return null;
  const ch = $("#chat"), d = document.createElement("div");
  d.className = "msg " + r; d.textContent = t;
  ch.querySelector(".suggest")?.remove(); ch.append(d);
  d.scrollIntoView({ block: "end", behavior: "smooth" });
  return d;
}
function perguntar(q) { state.tab = "copiloto"; render(); $("#chatInput").value = q; send(); }
async function send() {
  const box = $("#chatInput"), q = box.value.trim();
  if (!q || busy) return;
  box.value = ""; pushMsg("u", q);
  busy = true; $("#sendBtn").disabled = true;
  turns.push({ role: "user", content: q });
  const bubble = pushMsg("a", "Analisando...");
  const idx = chatLog.length - 1;
  try {
    const { text, proposals } = await api("/api/copilot", { history: turns.slice(-16) });
    chatLog[idx].t = text; if (bubble) bubble.textContent = text;
    turns.push({ role: "assistant", content: text });
    falar(text);
    for (const p of proposals || []) {
      const r = await confirmar(p);
      const nota = r.confirmado ? `Confirmado: ${r.resultado}` : r.erro ? `Não deu certo: ${r.erro}` : `Você recusou: ${p.resumo.titulo}`;
      pushMsg("sys", nota);
      turns.push({ role: "user", content: `[sistema] ${nota}` });
    }
  } catch (e) {
    chatLog[idx].t = e.message; if (bubble) bubble.textContent = e.message;
    turns.pop();
  } finally { busy = false; $("#sendBtn").disabled = false; }
}
$("#chatForm").addEventListener("submit", (e) => { e.preventDefault(); send(); });
$("#chatInput").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });

// ---------- Voz ----------
function falar(t) {
  try {
    if (!$("#speakToggle").checked || !window.speechSynthesis) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(t); u.lang = "pt-BR"; u.rate = 1.08; speechSynthesis.speak(u);
  } catch (e) {}
}
try { $("#speakToggle").checked = localStorage.getItem("ct_voz") === "1"; } catch (e) {}
$("#speakToggle").addEventListener("change", (e) => { try { localStorage.setItem("ct_voz", e.target.checked ? "1" : "0"); } catch (_) {} if (e.target.checked) falar("Pronto, vou responder em voz."); });
(function () {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition, mic = $("#micBtn"), hint = $("#voiceHint");
  const semMic = () => { hint.textContent = "Para falar, use o microfone do teclado do celular."; };
  if (!SR) { mic.onclick = () => { semMic(); $("#chatInput").focus(); }; return; }
  let rec = null;
  mic.onclick = () => {
    if (rec) { rec.stop(); return; }
    try {
      rec = new SR(); rec.lang = "pt-BR"; rec.interimResults = true;
      rec.onresult = (ev) => { $("#chatInput").value = [...ev.results].map((r) => r[0].transcript).join(""); if (ev.results[ev.results.length - 1].isFinal) rec.stop(); };
      rec.onerror = () => semMic();
      rec.onend = () => { mic.classList.remove("on"); rec = null; hint.textContent = ""; if ($("#chatInput").value.trim()) send(); };
      rec.start(); mic.classList.add("on"); hint.textContent = "Ouvindo...";
    } catch (e) { rec = null; semMic(); }
  };
})();

// ---------- Navegação ----------
function drawer(open) { $("#side").classList.toggle("open", open); $("#drawerScrim").hidden = !open; }
$("#menuBtn").addEventListener("click", () => drawer(true));
$("#drawerScrim").addEventListener("click", () => drawer(false));

function go(tab) { state.tab = tab; try { localStorage.setItem("ct_tab", tab); } catch (_) {} render(); window.scrollTo(0, 0); }
function handleClick(e) {
  const tr = e.target.closest("tr[data-open],tr[data-c]");
  if (tr && !e.target.closest("button")) {
    if (tr.dataset.open) return abrirCampanha(tr.dataset.open);
    state.client = tr.dataset.c; return render();
  }
  const b = e.target.closest("button,[data-help]");
  if (!b) return;
  if (b.closest("#side")) drawer(false);
  const d = b.dataset;
  if (d.tab) return go(d.tab);
  if (d.open) return abrirCampanha(d.open);
  if (d.plat) { state.plat = d.plat; return render(); }
  if (d.st) { state.st = d.st; return render(); }
  if (d.c && b.closest("#view")) { state.client = d.c; return render(); }
  if (d.sort) { state.sort = state.sort.k === d.sort ? { k: d.sort, dir: -state.sort.dir } : { k: d.sort, dir: ["nome", "loja", "status"].includes(d.sort) ? 1 : -1 }; return render(); }
  if (d.help) return ajuda(d.help);
  if (d.ask) return perguntar(d.ask);
  if (d.say) { $("#chatInput").value = d.say; return send(); }
  if (d.loja !== undefined) return editarLoja(d.loja);
  if (d.act === "nova") return novaCampanha();
  if (d.act === "novaloja") return editarLoja("");
  if (d.salvar) return salvarGrupo(d.salvar);
  if (d.act === "claudeapp") return conectarClaudeApp();
  if (d.pend) { const a = PENDENTES.find((x) => x.id === d.pend); return a && confirmar(a).then(() => load()); }
  if (d.diag) { const p = JSON.parse(d.diag); return propor({ tipo: p.tipo, campanhaId: p.c, dados: { orcamento: p.orcamento, motivo: "Diagnóstico automático" } }).then(() => { DIAG = null; }); }
  if (d.copiar) { const i = $("#" + d.copiar); return navigator.clipboard.writeText(i.value).then(() => toast("Copiado")).catch(() => { i.select(); }); }
  if (d.testar) return testarGrupo(d.testar);
  if (d.limpar) return api("/api/config", { [d.limpar]: null }).then((c) => { CONFIG = c; toast("Apagado"); load(true); }).catch((e) => toast(e.message));
  if (d.act === "desligar") return api("/api/desligar", {}).then(() => { document.body.innerHTML = `<div style="display:grid;place-items:center;height:100vh;text-align:center;padding:24px"><div><h2>TrafgFood desligado</h2><p style="color:var(--muted)">Para abrir de novo, use o ícone TrafgFood na área de trabalho.</p></div></div>`; }).catch((e) => toast(e.message));
  if (d.act === "setup" || d.act === "setupx") { try { d.act === "setup" ? localStorage.removeItem("tf_setup") : localStorage.setItem("tf_setup", d.f); } catch (_) {} return render(); }
  if (d.act === "relatorio") return relatorio();
}
for (const sel of ["#side", "#view", "#tabs"]) $(sel).addEventListener("click", handleClick);

function render() {
  renderFilters();
  $("#view").innerHTML = { painel: viewPainel, campanhas: viewCampanhas, copiloto: viewCopiloto, clientes: viewClientes, config: viewConfig }[state.tab]();
  $("#pageTitle").textContent = TITULOS[state.tab];
  document.querySelectorAll("#tabs button,#snav button").forEach((b) => b.setAttribute("aria-current", b.dataset.tab === state.tab ? "page" : "false"));
  $("#composer").hidden = state.tab !== "copiloto" || !IA;
  if (state.tab === "copiloto") $("#chat").lastElementChild?.scrollIntoView({ block: "end" });
}

// Volta do "Conectar com Google".
(function () {
  const q = new URLSearchParams(location.search), g = q.get("google");
  if (g === null) return;
  state.tab = "config";
  history.replaceState(null, "", "/");
  setTimeout(() => toast(g === "ok" ? "Google Ads conectado. Refresh token salvo." : g), 400);
})();
if (location.hash === "#config") { state.tab = "config"; history.replaceState(null, "", "/"); }

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
render();
load().then(() => { if (DESKTOP) carregarClaudeApp(); });
// Atualiza sozinho para mostrar propostas que chegam do app do Claude.
setInterval(() => { if (!document.hidden && !$("#sheetRoot").innerHTML && state.tab !== "config") load(); }, 20000);
