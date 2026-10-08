// TrafgFood: tela do gestor. Os números vêm do servidor (/api/state);
// toda mudança vira uma proposta que só é aplicada depois do "Confirmar".

const $ = (s) => document.querySelector(s);
const brl = (v) => "R$ " + Number(v || 0).toLocaleString("pt-BR", { maximumFractionDigits: 0 });
const brl2 = (v) => "R$ " + Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf = (v) => Number(v || 0).toLocaleString("pt-BR");
const dec = (v, n = 1) => Number(v).toFixed(n).replace(".", ",");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

let CLIENTES = [], CAMPANHAS = [], LOG = [], ERROS = {}, CONEX = {};
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
const stLabel = { ativa: "Ativa", pausada: "Pausada", em_analise: "Em análise" };
const stClass = { ativa: "ativa", pausada: "pausada", em_analise: "analise" };
const platLabel = { meta: "Meta", google: "Google" };
const TITULOS = { painel: "Painel de resultados", campanhas: "Campanhas", copiloto: "Gestor de tráfego IA", clientes: "Lojas e contas" };

let state = { tab: "painel", client: "todos", plat: "todas" };
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
async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== "/api/login") { showLogin(); throw new Error(json.erro || "Entre com a senha."); }
  if (!res.ok) throw new Error(json.erro || "Erro " + res.status);
  return json;
}
function apply(s) {
  CLIENTES = s.clients; CAMPANHAS = s.campaigns; LOG = s.audit || []; ERROS = s.errors || {}; CONEX = s.connections || {};
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
  f.hidden = state.tab === "copiloto" || state.tab === "clientes";
  $("#ctx").textContent = state.client === "todos" ? "Todas as lojas" : cli(state.client).nome;
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
  return out.slice(0, 5);
}
function viewPainel() {
  const list = visiveis(), t = totais(list), al = alertas(list);
  return `
  <div class="kpis">
    <div class="kpi" data-help="gasto"><div class="l">Investido · 7 dias ⓘ</div><div class="v">${brl(t.g)}</div><div class="d">${list.filter((c) => c.status === "ativa").length} campanhas ativas</div></div>
    <div class="kpi" data-help="receita"><div class="l">Receita atribuída ⓘ</div><div class="v">${brl(t.r)}</div><div class="d">${list.some((c) => c.receitaEstimada) ? "parte estimada pelo ticket" : "medida pela plataforma"}</div></div>
    <div class="kpi" data-help="pedidos"><div class="l">Pedidos ⓘ</div><div class="v">${nf(t.p)}</div><div class="d">Custo/pedido ${brl2(t.cpa)}</div></div>
    <div class="kpi" data-help="roas"><div class="l">ROAS ⓘ</div><div class="v">${dec(t.roas)}×</div><div class="d">${nf(t.cl)} cliques</div></div>
  </div>
  <div class="chartcard">
    <div class="hd"><span>Gasto por dia (R$)</span><span class="legend"><span><i style="background:var(--meta)"></i>Meta</span><span><i style="background:var(--google)"></i>Google</span></span></div>
    ${chart(list)}
  </div>
  <h2>Precisa de atenção</h2>
  <div class="alerts">${al.length ? al.map((a) => `<div class="alert ${a.cls}"><p>${a.txt}</p>${a.id ? `<button class="btn sm" data-ask="O que eu faço com a campanha ${esc(camp(a.id)?.nome)}?">O que faço?</button>` : ""}</div>`).join("") : `<div class="empty">Nada fora do normal.</div>`}</div>
  <h2>Ações rápidas</h2>
  <div class="row"><button class="btn pri" data-act="nova">Nova campanha</button><button class="btn" data-ask="Faz um diagnóstico da semana e me diz o que fazer hoje">Diagnóstico da semana</button><button class="btn" data-act="relatorio">Relatório do cliente</button></div>
  ${LOG.length ? `<h2>Últimas alterações</h2><div class="list">${LOG.slice(0, 6).map((l) => `<div class="alert ${l.resultado === "falhou" ? "bad" : "good"}"><p>${esc(l.resultado === "falhou" ? "Falhou: " + l.detalhe : l.resultado)}<br><small style="color:var(--muted)">${esc(l.quem || "")} · ${esc(l.origem || "")} · ${new Date(l.at).toLocaleString("pt-BR")}</small></p></div>`).join("")}</div>` : ""}`;
}

// ---------- Campanhas ----------
function campCard(c) {
  const k = m(c);
  return `
  <button class="camp" data-open="${esc(c.id)}">
    <span class="n">${esc(c.nome)}</span><span class="st ${stClass[c.status]}">${stLabel[c.status]}</span>
    <span class="meta"><span class="tag ${c.plataforma}">${platLabel[c.plataforma]}</span>${esc(c.canal)} · ${esc(cli(c.clientId).nome)} · <span class="num">${c.orcamento != null ? brl(c.orcamento) + "/dia" : "orçamento no conjunto"}</span></span>
    <span class="stats"><div><span>Gasto 7d</span><b>${brl(c.gasto7)}</b></div><div><span>Pedidos</span><b>${nf(c.pedidos)}</b></div><div><span>Custo/ped.</span><b>${c.pedidos ? brl2(k.cpa) : "–"}</b></div><div><span>ROAS</span><b>${c.gasto7 ? dec(k.roas) : "–"}</b></div></span>
  </button>`;
}
function viewCampanhas() {
  const list = visiveis();
  return `<div class="row" style="justify-content:space-between;align-items:center">
    <div class="row">${["todas", "meta", "google"].map((p) => `<button class="chip" data-plat="${p}" aria-pressed="${state.plat === p}">${p === "todas" ? "Todas" : platLabel[p]}</button>`).join("")}</div>
    <button class="btn pri sm" data-act="nova">+ Nova</button></div>
  <h2>${list.length} campanha${list.length === 1 ? "" : "s"}</h2>
  <div class="list">${list.map(campCard).join("") || `<div class="empty">Nenhuma campanha neste filtro.</div>`}</div>`;
}

// ---------- Lojas e contas ----------
function viewClientes() {
  return `<div class="row" style="justify-content:space-between;align-items:center"><h2 style="margin:0">Restaurantes atendidos</h2><button class="btn pri sm" data-loja="">+ Loja</button></div>
  <div class="clients" style="margin-top:10px">${CLIENTES.map((c) => {
    const cs = CAMPANHAS.filter((x) => x.clientId === c.id), t = totais(cs), n = cs.filter((x) => x.status === "ativa").length;
    return `<button class="client" data-loja="${esc(c.id)}" style="border:0;text-align:left;width:100%"><div class="av" style="background:${esc(c.cor || "#1DB46A")}">${esc(c.nome[0])}</div><div class="info"><b>${esc(c.nome)}</b><span>${esc(c.cidade)} · ${n} ativa${n === 1 ? "" : "s"} · ${c.metaAdAccountId ? "Meta ✓" : "sem Meta"} · ${c.googleCustomerId ? "Google ✓" : "sem Google"}</span></div><div class="r"><b>${brl(t.g)}</b>ROAS ${dec(t.roas)}</div></button>`;
  }).join("")}</div>
  <h2>Contas conectadas</h2>
  <div class="list">
    <div class="conn"><div class="h"><span class="tag meta">Meta</span> Facebook e Instagram <span class="st ${CONEX.meta ? "ativa" : "pausada"}" style="margin-left:auto">${CONEX.meta ? "Conectado" : "Modo exemplo"}</span></div>
      ${CONEX.meta ? `<div class="sub" style="margin:0">Cadastre o ID da conta de anúncio (act_...) em cada loja.</div>` : `<ol><li>Business Manager verificado</li><li>App com Marketing API e acesso avançado a ads_management</li><li>Token de usuário do sistema em META_ACCESS_TOKEN no servidor</li></ol>`}</div>
    <div class="conn"><div class="h"><span class="tag google">Google</span> Google Ads <span class="st ${CONEX.google ? "ativa" : "pausada"}" style="margin-left:auto">${CONEX.google ? "Conectado" : "Modo exemplo"}</span></div>
      ${CONEX.google ? `<div class="sub" style="margin:0">Cadastre o ID de cliente Google Ads (123-456-7890) em cada loja.</div>` : `<ol><li>Conta de administrador (MCC) com os clientes vinculados</li><li>Developer token com Basic Access</li><li>Login OAuth do Google Cloud nas variáveis GOOGLE_ADS_* do servidor</li></ol>`}</div>
  </div>`;
}
function editarLoja(id) {
  const c = CLIENTES.find((x) => x.id === id) || {};
  sheet(`<h3>${c.id ? "Editar loja" : "Nova loja"}</h3>
    <div class="field"><label for="lj-nome">Nome</label><input id="lj-nome" value="${esc(c.nome || "")}"></div>
    <div class="grid2"><div class="field"><label for="lj-cid">Cidade / bairro</label><input id="lj-cid" value="${esc(c.cidade || "")}"></div>
    <div class="field"><label for="lj-tk">Ticket médio (R$)</label><input id="lj-tk" type="number" inputmode="decimal" value="${esc(c.ticket || "")}"></div></div>
    <div class="field"><label for="lj-mg">Margem de contribuição antes da mídia (%)</label><input id="lj-mg" type="number" inputmode="decimal" placeholder="ex.: 28" value="${esc(c.margem || "")}"><span class="sub" style="margin:0">O que sobra do pedido depois de CMV, embalagem, taxas, entrega e impostos. Define o ROAS mínimo da loja.</span></div>
    <div class="field"><label for="lj-meta">Conta de anúncio Meta</label><input id="lj-meta" placeholder="act_1234567890" value="${esc(c.metaAdAccountId || "")}"></div>
    <div class="field"><label for="lj-goo">ID de cliente Google Ads</label><input id="lj-goo" placeholder="123-456-7890" value="${esc(c.googleCustomerId || "")}"></div>
    <div class="row"><button class="btn pri" id="lj-ok">Salvar</button><button class="btn" id="lj-x">Cancelar</button></div>`, (s) => {
    s.querySelector("#lj-x").onclick = closeSheet;
    s.querySelector("#lj-ok").onclick = async () => {
      const v = (q) => s.querySelector(q).value;
      try {
        await api("/api/clients", { id: c.id, nome: v("#lj-nome"), cidade: v("#lj-cid"), ticket: v("#lj-tk"), margem: v("#lj-mg"), metaAdAccountId: v("#lj-meta"), googleCustomerId: v("#lj-goo") });
        closeSheet(); toast("Loja salva"); load(true);
      } catch (e) { toast(e.message); }
    };
  });
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
  return `<div class="chat" id="chat">${chatLog.map((x) => `<div class="msg ${x.r}">${esc(x.t)}</div>`).join("")}
  ${chatLog.length < 2 ? `<div class="suggest">${["O que eu devo fazer hoje nas campanhas?", "Qual campanha está dando prejuízo?", "Monta um plano de R$ 1.500 por mês para uma loja nova", "Me explica o que é ROAS"].map((s) => `<button class="chip" data-say="${esc(s)}">${esc(s)}</button>`).join("")}</div>` : ""}</div>`;
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
  const b = e.target.closest("button,[data-help]");
  if (!b) return;
  if (b.closest("#side")) drawer(false);
  const d = b.dataset;
  if (d.tab) return go(d.tab);
  if (d.open) return abrirCampanha(d.open);
  if (d.plat) { state.plat = d.plat; return render(); }
  if (d.help) return ajuda(d.help);
  if (d.ask) return perguntar(d.ask);
  if (d.say) { $("#chatInput").value = d.say; return send(); }
  if (d.loja !== undefined) return editarLoja(d.loja);
  if (d.act === "nova") return novaCampanha();
  if (d.act === "relatorio") return relatorio();
}
for (const sel of ["#side", "#view", "#tabs"]) $(sel).addEventListener("click", handleClick);

function render() {
  renderFilters();
  $("#view").innerHTML = { painel: viewPainel, campanhas: viewCampanhas, copiloto: viewCopiloto, clientes: viewClientes }[state.tab]();
  $("#pageTitle").textContent = TITULOS[state.tab];
  document.querySelectorAll("#tabs button,#snav button").forEach((b) => b.setAttribute("aria-current", b.dataset.tab === state.tab ? "page" : "false"));
  $("#composer").hidden = state.tab !== "copiloto";
  if (state.tab === "copiloto") $("#chat").lastElementChild?.scrollIntoView({ block: "end" });
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
render();
load();
