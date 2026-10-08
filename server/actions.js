// Toda mudança nas contas passa por aqui, venha da tela ou do gestor IA:
// 1) propose() registra o que vai mudar e quanto custa;
// 2) só confirm(), disparado por um toque da pessoa em "Confirmar", executa na plataforma.
import { store } from "./store.js";
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
    const orc = Math.max(6, Math.round(Number(dados.orcamento) || 0));
    if (!store.get().clients.some((c) => c.id === dados.clientId)) throw new Error("Loja não encontrada.");
    if (!PLATFORMS.includes(dados.plataforma)) throw new Error("Plataforma deve ser meta ou google.");
    dados = { ...dados, orcamento: orc };
    resumo = {
      titulo: "Criar campanha?",
      linhas: [
        ["Loja", clientName(dados.clientId)],
        ["Plataforma", `${dados.plataforma === "meta" ? "Meta" : "Google"} · ${dados.canal || ""}`],
        ["Nome", dados.nome],
        ["Objetivo", dados.objetivo || ""],
        ["Público", dados.publico || `Raio de ${dados.raio || 5} km`],
        ["Orçamento", `${brl(orc)}/dia`],
      ],
      custo: `Pode gastar até ${brl(orc)}/dia (≈ ${brl(orc * 30)}/mês) depois de ativada.`,
    };
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
