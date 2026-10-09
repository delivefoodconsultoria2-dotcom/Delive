// Toda mudança nas contas passa por aqui, venha da tela ou do gestor IA:
// 1) propose() registra o que vai mudar e quanto custa;
// 2) só confirm(), disparado por um toque da pessoa em "Confirmar", executa na plataforma.
import { store } from "./store.js";
import { META_OBJETIVOS } from "./providers/meta.js";
import { provider, PLATFORMS, platformOf, externalId, connections } from "./providers/index.js";

const CACHE_MS = 60_000;
let cache = { at: 0, data: null, errors: {} };

const brl = (v) => "R$ " + Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 0 });

export async function campaigns({ fresh = false } = {}) {
  if (!fresh && cache.data && Date.now() - cache.at < CACHE_MS) return cache;
  const errors = {};
  const lists = await Promise.all(
    PLATFORMS.map((p) =>
      provider(p).listCampaigns().catch((e) => {
        errors[p] = e.message;
        return [];
      }),
    ),
  );
  cache = { at: Date.now(), data: lists.flat(), errors };
  return cache;
}

export function invalidate() {
  cache.at = 0;
}

export async function state() {
  const { data, errors, at } = await campaigns();
  const db = store.get();
  return {
    atualizadoEm: new Date(at).toISOString(),
    ia: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
    clients: db.clients,
    campaigns: data,
    errors,
    connections: connections(),
    pending: db.actions.filter((a) => a.status === "pendente"),
    rascunhos: db.rascunhos || [],
    audit: db.audit.slice(-20).reverse(),
  };
}

async function findCampaign(id) {
  const { data } = await campaigns();
  const c = data.find((x) => x.id === id);
  if (!c) throw new Error("Campanha não encontrada: " + id);
  return c;
}

function clientName(id) {
  return store.get().clients.find((c) => c.id === id)?.nome || id;
}

// Monta a proposta com o texto que a tela de confirmação mostra.
export async function propose({ tipo, campanhaId, dados = {}, origem = "tela" }) {
  let resumo;
  if (tipo === "pausar" || tipo === "ativar") {
    const c = await findCampaign(campanhaId);
    if (tipo === "pausar" && c.status !== "ativa") throw new Error("Essa campanha não está ativa.");
    if (tipo === "ativar" && c.status !== "pausada") throw new Error("Essa campanha não está pausada.");
    resumo = {
      titulo: `${tipo === "pausar" ? "Pausar" : "Reativar"} ${c.nome}?`,
      linhas: [["Loja", clientName(c.clientId)], ["Plataforma", `${c.plataforma === "meta" ? "Meta" : "Google"} · ${c.canal}`]],
      custo: tipo === "ativar" && c.orcamento ? `Volta a gastar até ${brl(c.orcamento)}/dia (≈ ${brl(c.orcamento * 30)}/mês).` : "",
      perigo: tipo === "pausar",
    };
  } else if (tipo === "finalizar") {
    const c = await findCampaign(campanhaId);
    resumo = {
      titulo: `Finalizar ${c.nome}?`,
      linhas: [["Loja", clientName(c.clientId)], ["Plataforma", `${c.plataforma === "meta" ? "Meta" : "Google"} · ${c.canal}`], ["Gasto 7 dias", brl(c.gasto7 || 0)]],
      custo: `Encerra de vez: a campanha para de gastar e ${c.plataforma === "meta" ? "é arquivada na Meta" : "é removida do Google Ads"}. Não dá para reativar depois; para voltar, é preciso criar outra.`,
      perigo: true,
    };
  } else if (tipo === "orcamento") {
    const c = await findCampaign(campanhaId);
    const novo = Math.round(Number(dados.orcamento));
    if (!(novo >= 6)) throw new Error("O orçamento mínimo é R$ 6 por dia.");
    if (c.orcamento == null) throw new Error("Essa campanha usa orçamento no conjunto de anúncios; ajuste direto na plataforma.");
    const diff = novo - c.orcamento;
    dados = { orcamento: novo, anterior: c.orcamento };
    resumo = {
      titulo: `Alterar orçamento de ${c.nome}?`,
      linhas: [["Atual", `${brl(c.orcamento)}/dia`], ["Novo", `${brl(novo)}/dia`], ["Diferença", `${diff >= 0 ? "+" : ""}${brl(diff)}/dia`]],
      custo: diff > 0 ? `Aumenta o gasto em até ${brl(diff * 30)}/mês.` : "",
    };
  } else if (tipo === "criar") {
    ({ dados, resumo } = validarCriacao(dados));
  } else {
    throw new Error("Tipo de ação desconhecido: " + tipo);
  }
  const action = { id: store.id("a"), tipo, campanhaId, dados, origem, resumo, status: "pendente", criadaEm: new Date().toISOString() };
  store.update((d) => {
    d.actions.push(action);
    d.actions = d.actions.slice(-500);
  });
  return action;
}

const txt = (v, max) => String(v || "").trim().slice(0, max);
const lista = (v, max, lim) => (Array.isArray(v) ? v : String(v || "").split(/\n|;/)).map((x) => txt(x, max)).filter(Boolean).slice(0, lim);

// Confere a campanha nova com as mesmas exigências da Meta e do Google antes de virar proposta.
function validarCriacao(d) {
  const loja = store.get().clients.find((c) => c.id === d.clientId);
  if (!loja) throw new Error("Escolha a loja.");
  if (!PLATFORMS.includes(d.plataforma)) throw new Error("Plataforma deve ser meta ou google.");
  const orc = Math.round(Number(d.orcamento) || 0);
  if (orc < 6) throw new Error("O orçamento mínimo é R$ 6 por dia.");
  const raio = Math.min(40, Math.max(1, Math.round(Number(d.raio) || 5)));
  const nome = txt(d.nome, 120);
  if (!nome) throw new Error("Dê um nome para a campanha.");
  const area = d.area === "brasil" ? "brasil" : "raio";
  const base = { clientId: loja.id, plataforma: d.plataforma, nome, orcamento: orc, raio, area };
  const onde = area === "brasil" ? "Brasil inteiro" : `${raio} km da loja`;
  const linhas = [["Loja", loja.nome], ["Nome", nome]];
  let dados;
  if (d.plataforma === "meta") {
    const obj = META_OBJETIVOS[d.objetivo] ? d.objetivo : "whatsapp";
    if (!d.paginaId) throw new Error("Escolha a página do Facebook que vai assinar o anúncio.");
    if (!d.imagemId) throw new Error("Escolha a foto do anúncio.");
    const texto = txt(d.texto, 2000);
    if (!texto) throw new Error("Escreva o texto principal do anúncio.");
    if (obj !== "whatsapp" && !/^https?:\/\//.test(d.link || "")) throw new Error("Coloque o link de destino (iFood, cardápio ou site), começando com https://");
    const pos = Array.isArray(d.posicionamentos) && d.posicionamentos.length ? d.posicionamentos.filter((x) => ["feed", "stories", "reels"].includes(x)) : [];
    dados = { ...base, canal: "Instagram + Facebook", objetivo: obj, objetivoRotulo: META_OBJETIVOS[obj].rotulo,
      idadeMin: Math.max(18, Number(d.idadeMin) || 18), idadeMax: Math.min(65, Number(d.idadeMax) || 65), posicionamentos: pos,
      paginaId: String(d.paginaId), pagina: txt(d.pagina, 120), instagramId: String(d.instagramId || ""), imagemId: String(d.imagemId),
      interesses: lista(d.interesses, 60, 10), texto, titulo: txt(d.titulo, 255), descricao: txt(d.descricao, 255), botao: txt(d.botao, 40) || "ORDER_NOW", link: txt(d.link, 500) };
    linhas.push(["Plataforma", "Meta · Facebook e Instagram"], ["Objetivo", dados.objetivoRotulo],
      ["Público", `${onde} · ${dados.idadeMin} a ${dados.idadeMax}${dados.idadeMax === 65 ? "+" : ""} anos${dados.interesses.length ? " · " + dados.interesses.join(", ") : ""}`],
      ["Posicionamentos", pos.length ? pos.map((x) => ({ feed: "Feed", stories: "Stories", reels: "Reels" })[x]).join(", ") : "Automático (Advantage+)"],
      ["Página", dados.pagina || dados.paginaId], ["Texto", texto.length > 90 ? texto.slice(0, 90) + "…" : texto], ["Destino", obj === "whatsapp" ? "WhatsApp da página" : dados.link]);
  } else {
    const palavras = lista(d.palavras, 80, 30), titulos = lista(d.titulos, 30, 15), descricoes = lista(d.descricoes, 90, 4);
    if (palavras.length < 3) throw new Error("Coloque pelo menos 3 palavras-chave.");
    if (titulos.length < 3) throw new Error("O Google pede pelo menos 3 títulos (até 30 letras cada).");
    if (descricoes.length < 2) throw new Error("O Google pede pelo menos 2 descrições (até 90 letras cada).");
    if (!/^https?:\/\//.test(d.link || "")) throw new Error("Coloque o link de destino (cardápio ou site), começando com https://");
    dados = { ...base, canal: "Pesquisa", objetivo: "Cliques para pedir", palavras, titulos, descricoes, link: txt(d.link, 500) };
    linhas.push(["Plataforma", "Google Ads · Pesquisa"], ["Região", onde], ["Palavras-chave", palavras.slice(0, 6).join(", ") + (palavras.length > 6 ? "…" : "")],
      ["Títulos", `${titulos.length}`], ["Descrições", `${descricoes.length}`], ["Destino", dados.link]);
  }
  linhas.push(["Orçamento", `${brl(orc)}/dia`]);
  return { dados, resumo: { titulo: "Criar campanha?", linhas, custo: `Nasce PAUSADA, com tudo pronto. Quando você reativar, gasta até ${brl(orc)}/dia (≈ ${brl(orc * 30)}/mês).` } };
}

// Campanha montada pelo gestor IA: fica como rascunho até a pessoa abrir, completar e criar.
export function salvarRascunho(dados, origem) {
  const r = { id: store.id("r"), dados, origem, criadoEm: new Date().toISOString() };
  store.update((d) => { d.rascunhos = [...(d.rascunhos || []), r].slice(-50); });
  return r;
}
export function descartarRascunho(id) {
  store.update((d) => { d.rascunhos = (d.rascunhos || []).filter((r) => r.id !== id); });
}

export async function confirm(id, quem) {
  const action = store.get().actions.find((a) => a.id === id);
  if (!action) throw new Error("Ação não encontrada.");
  if (action.status !== "pendente") throw new Error("Essa ação já foi " + action.status + ".");
  // Marca antes de executar para que um segundo toque não aplique duas vezes.
  store.update(() => { action.status = "executando"; });
  let msg;
  try {
    if (action.tipo === "pausar" || action.tipo === "ativar") {
      await provider(platformOf(action.campanhaId)).setStatus(externalId(action.campanhaId), action.tipo === "pausar" ? "pausada" : "ativa");
      msg = action.resumo.titulo.replace("?", "").replace("Pausar", "Pausada:").replace("Reativar", "Reativada:");
    } else if (action.tipo === "finalizar") {
      await provider(platformOf(action.campanhaId)).finalize(externalId(action.campanhaId));
      msg = action.resumo.titulo.replace("?", "").replace("Finalizar", "Finalizada:");
    } else if (action.tipo === "orcamento") {
      await provider(platformOf(action.campanhaId)).setDailyBudget(externalId(action.campanhaId), action.dados.orcamento);
      msg = `Orçamento ${brl(action.dados.anterior)} → ${brl(action.dados.orcamento)}/dia`;
    } else if (action.tipo === "criar") {
      const r = await provider(action.dados.plataforma).createCampaign(action.dados);
      msg = `${action.dados.nome} criada` + (r.observacao ? `. ${r.observacao}` : "");
    }
  } catch (e) {
    store.update(() => { action.status = "falhou"; action.erro = e.message; });
    store.audit({ quem, origem: action.origem, acao: action.tipo, campanha: action.campanhaId, resultado: "falhou", detalhe: e.message });
    throw e;
  }
  store.update(() => { action.status = "confirmada"; action.resultado = msg; });
  store.audit({ quem, origem: action.origem, acao: action.tipo, campanha: action.campanhaId, dados: action.dados, resultado: msg });
  invalidate();
  return { ...action };
}

export function reject(id) {
  return store.update((d) => {
    const a = d.actions.find((x) => x.id === id);
    if (a && a.status === "pendente") a.status = "recusada";
    return a;
  });
}
