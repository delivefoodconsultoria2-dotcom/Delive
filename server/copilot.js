// Gestor de tráfego IA: Claude com ferramentas que leem as campanhas e
// PROPÕEM mudanças. Nenhuma ferramenta gasta dinheiro: as propostas voltam
// para a tela e só são aplicadas quando a pessoa toca em "Confirmar".
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { campaigns, propose, salvarRascunho } from "./actions.js";
import { store } from "./store.js";
import { ROOT } from "./paths.js";
import { diagnosticar } from "./diagnostico.js";
import { BASES } from "./especialista.js";

// Recriado quando a chave muda pela tela Configurações.
let client, chaveAtual;
const claude = () => {
  const k = process.env.ANTHROPIC_API_KEY;
  if (!client || k !== chaveAtual) { client = new Anthropic({ apiKey: k }); chaveAtual = k; }
  return client;
};
const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";
const EFFORT = process.env.CLAUDE_EFFORT || "medium";

// Base de conhecimento da Delivefood (server/knowledge). Vai inteira no prompt, em cache.
const BASE = JSON.parse(fs.readFileSync(path.join(ROOT, "server", "knowledge", "base-trafego-delivery.json"), "utf8"));
const { dados_para_treinamento_supervisionado: _treino, ...BASE_PROMPT } = BASE;

export const PLAYBOOK = `${BASE.configuracao_do_especialista.prompt_base}

Você trabalha dentro do TrafgFood, o sistema de tráfego pago da Delivefood Consultoria, que atende vários restaurantes. Quem fala com você pode não saber tráfego pago: explique sem jargão (se usar um termo como ROAS ou CPA, explique em meia frase) e termine sempre com a próxima ação concreta e a métrica que vai decidir se ela continua, muda ou para.

Tamanho da resposta: por padrão até 8 linhas, porque pode ser lida em voz alta. Use o formato completo da base (Diagnóstico, Objetivo e hipótese, Estratégia por canal, ...) só quando pedirem um plano, diagnóstico completo ou estratégia de uma loja.

Fonte de verdade: a BASE DE CONHECIMENTO DELIVEFOOD abaixo. Siga os princípios, a árvore de diagnóstico, as fórmulas de decisão, as regras de escala e as regras para respostas da IA. Não use benchmarks fixos de mercado: calcule ROAS de equilíbrio e CPA máximo da loja com as fórmulas da base. Quando a margem da loja não estiver cadastrada, diga que é hipótese, use a margem informada pela pessoa ou peça o dado.

Como agir no sistema:
- Use buscar_campanhas para ver números antes de opinar sobre uma loja. Os resultados já trazem roas_equilibrio, cpa_maximo e margem_apos_midia_estimada quando a loja tem ticket e margem cadastrados.
- Para pausar, reativar, mudar orçamento ou criar campanha, use as ferramentas propor_*. Elas NÃO executam: criam uma proposta que a pessoa confirma na tela. Diga "deixei pronto para você confirmar", nunca "fiz".
- Nunca proponha aumentar orçamento de campanha sem conversão medida ou com ROAS abaixo do equilíbrio da loja.
- Se o pedido servir para mais de uma campanha e não estiver claro qual, pergunte antes.
- Receita marcada como estimada (pedidos × ticket) não é prova de lucro; avise quando isso importar.

Dois focos: cada loja ou negócio tem foco "comida" (restaurante vendendo pedidos) ou "servico" (venda de serviço, como a própria consultoria Delivefood e a gestão de tráfego que ela vende). buscar_campanhas traz o foco. Para foco comida use a BASE DE RESTAURANTES; para foco servico use a BASE DE SERVIÇOS, onde "pedidos" significam contatos/leads e o que importa é custo por contato qualificado, reunião e contrato.

BASE DE RESTAURANTES (versão ${BASE.metadata.versao}):
${JSON.stringify(BASE_PROMPT)}
${BASES.servico ? `
BASE DE SERVIÇOS (versão ${BASES.servico.metadata?.versao || "1"}):
${JSON.stringify(BASES.servico)}` : ""}`;

export const TOOLS = [
  {
    name: "diagnostico_automatico",
    description: "Diagnóstico da semana pelas regras da Base Delivefood (prejuízo, sem pedidos, CTR baixo, CPM alto, oportunidades de escala), com o que verificar e o que fazer. Bom ponto de partida antes de analisar.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "buscar_campanhas",
    description: "Lista campanhas com números dos últimos 7 dias (gasto, pedidos, custo por pedido, ROAS, CTR, orçamento diário, status). Filtre por loja ou plataforma quando souber.",
    input_schema: {
      type: "object",
      properties: {
        loja_id: { type: "string", description: "id da loja, opcional" },
        plataforma: { type: "string", enum: ["meta", "google"] },
      },
    },
  },
  {
    name: "propor_pausa",
    description: "Cria uma proposta para pausar uma campanha ativa. A pessoa confirma na tela.",
    input_schema: { type: "object", properties: { campanha_id: { type: "string" }, motivo: { type: "string" } }, required: ["campanha_id"] },
  },
  {
    name: "propor_reativar",
    description: "Cria uma proposta para reativar uma campanha pausada. A pessoa confirma na tela.",
    input_schema: { type: "object", properties: { campanha_id: { type: "string" }, motivo: { type: "string" } }, required: ["campanha_id"] },
  },
  {
    name: "propor_finalizar",
    description: "Cria uma proposta para FINALIZAR (encerrar de vez) uma campanha: arquiva na Meta ou remove no Google Ads, sem volta. Use só quando a pessoa pedir para finalizar ou encerrar. A pessoa confirma na tela.",
    input_schema: { type: "object", properties: { campanha_id: { type: "string" }, motivo: { type: "string" } }, required: ["campanha_id"] },
  },
  {
    name: "propor_orcamento",
    description: "Cria uma proposta para mudar o orçamento diário (em reais) de uma campanha. A pessoa confirma na tela.",
    input_schema: {
      type: "object",
      properties: { campanha_id: { type: "string" }, orcamento_dia: { type: "number" }, motivo: { type: "string" } },
      required: ["campanha_id", "orcamento_dia"],
    },
  },
  {
    name: "montar_campanha",
    description: "Monta uma campanha nova completa, no formato que a plataforma pede, e deixa como RASCUNHO no TrafgFood. A pessoa abre o rascunho, escolhe a foto (Meta), revisa e cria; a campanha nasce pausada. Meta: objetivo whatsapp (conversas no WhatsApp), trafego (visitas ao site, cardápio ou iFood; exige link) ou alcance. Google: campanha de Pesquisa com palavras-chave (mín. 3), títulos (3 a 15, até 30 caracteres) e descrições (2 a 4, até 90 caracteres) e link. area: raio (em volta da loja) ou brasil (bom para venda de serviço). Siga o framework de criativos da base do foco da loja.",
    input_schema: {
      type: "object",
      properties: {
        loja_id: { type: "string" },
        plataforma: { type: "string", enum: ["meta", "google"] },
        nome: { type: "string" },
        objetivo: { type: "string", enum: ["whatsapp", "trafego", "alcance"] },
        orcamento_dia: { type: "number" },
        area: { type: "string", enum: ["raio", "brasil"] },
        raio_km: { type: "number" },
        idade_min: { type: "number" },
        idade_max: { type: "number" },
        interesses: { type: "array", items: { type: "string" }, description: "Meta: interesses em português, opcional" },
        posicionamentos: { type: "array", items: { type: "string", enum: ["feed", "stories", "reels"] }, description: "vazio = automático" },
        texto: { type: "string", description: "Meta: texto principal" },
        titulo: { type: "string", description: "Meta: título curto" },
        descricao: { type: "string" },
        botao: { type: "string", enum: ["ORDER_NOW", "LEARN_MORE", "SHOP_NOW", "SIGN_UP", "CONTACT_US", "BOOK_NOW", "GET_QUOTE"] },
        link: { type: "string" },
        palavras: { type: "array", items: { type: "string" } },
        titulos: { type: "array", items: { type: "string" } },
        descricoes: { type: "array", items: { type: "string" } },
        motivo: { type: "string", description: "por que essa estrutura, em 1 a 2 frases" },
      },
      required: ["loja_id", "plataforma", "nome", "orcamento_dia"],
    },
  },
];

function resumoCampanha(c) {
  return {
    id: c.id,
    loja_id: c.clientId,
    foco: store.get().clients.find((x) => x.id === c.clientId)?.foco || "comida",
    plataforma: c.plataforma,
    formato: c.canal,
    nome: c.nome,
    status: c.status,
    orcamento_dia: c.orcamento,
    gasto_7d: c.gasto7,
    pedidos_7d: c.pedidos,
    custo_por_pedido: c.pedidos ? +(c.gasto7 / c.pedidos).toFixed(2) : null,
    roas: c.gasto7 ? +(c.receita / c.gasto7).toFixed(2) : null,
    ctr_pct: c.impressoes ? +((c.cliques / c.impressoes) * 100).toFixed(2) : null,
    receita_estimada: Boolean(c.receitaEstimada || c.exemplo),
    ...metasDaLoja(c),
  };
}

// Fórmulas de decisão da base: ROAS de equilíbrio = 1 / margem; CPA máximo do 1º pedido = ticket × margem.
function metasDaLoja(c) {
  const loja = store.get().clients.find((x) => x.id === c.clientId);
  const margem = Number(loja?.margem) / 100;
  if (!(margem > 0 && margem < 1)) return { margem_cadastrada: false };
  const ticket = Number(loja.ticket) || 0;
  const out = { margem_cadastrada: true, margem_pct: loja.margem, roas_equilibrio: +(1 / margem).toFixed(2) };
  if (ticket) out.cpa_maximo_primeiro_pedido = +(ticket * margem).toFixed(2);
  if (c.receita) out.margem_apos_midia_estimada = Math.round(c.receita * margem - c.gasto7);
  return out;
}

export async function runTool(name, input, proposals = [], origem = "gestor IA") {
  switch (name) {
    case "diagnostico_automatico": {
      const { data } = await campaigns();
      return diagnosticar(data, store.get().clients).itens;
    }
    case "buscar_campanhas": {
      const { data } = await campaigns();
      return data
        .filter((c) => (!input.loja_id || c.clientId === input.loja_id) && (!input.plataforma || c.plataforma === input.plataforma))
        .map(resumoCampanha);
    }
    case "propor_pausa":
    case "propor_reativar":
    case "propor_finalizar":
    case "propor_orcamento": {
      const tipo = { propor_pausa: "pausar", propor_reativar: "ativar", propor_finalizar: "finalizar", propor_orcamento: "orcamento" }[name];
      const a = await propose({ tipo, campanhaId: String(input.campanha_id), dados: { orcamento: input.orcamento_dia, motivo: input.motivo }, origem });
      proposals.push(a);
      return { proposta: a.id, situacao: "aguardando confirmação da pessoa na tela" };
    }
    case "montar_campanha": {
      const loja = store.get().clients.find((c) => c.id === String(input.loja_id));
      if (!loja) throw new Error("Loja não encontrada. Use buscar_campanhas para ver os ids das lojas.");
      const r = salvarRascunho({
        clientId: loja.id, plataforma: input.plataforma === "google" ? "google" : "meta", nome: input.nome, objetivo: input.objetivo || "whatsapp",
        orcamento: input.orcamento_dia, area: input.area || "raio", raio: input.raio_km || 5, idadeMin: input.idade_min, idadeMax: input.idade_max,
        interesses: input.interesses || [], posicionamentos: input.posicionamentos || [], texto: input.texto, titulo: input.titulo, descricao: input.descricao,
        botao: input.botao, link: input.link, palavras: input.palavras || [], titulos: input.titulos || [], descricoes: input.descricoes || [], motivo: input.motivo,
      }, origem);
      return { rascunho: r.id, situacao: "Rascunho salvo no TrafgFood (Painel > Campanhas montadas pelo gestor). A pessoa escolhe a foto, revisa e cria; nasce pausada." };
    }
    default:
      throw new Error("Ferramenta desconhecida: " + name);
  }
}

// history: [{role:"user"|"assistant", content:string}], terminando na fala da pessoa.
export async function ask(history) {
  const lojas = store.get().clients.map((c) => ({ id: c.id, nome: c.nome, cidade: c.cidade, ticket_medio: c.ticket, margem_pct: c.margem || null }));
  const messages = history.slice(-16).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content) }));
  if (messages[0]?.role !== "user") messages.shift();
  const proposals = [];

  for (let i = 0; i < 8; i++) {
    const response = await claude().beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: EFFORT },
      system: [
        { type: "text", text: PLAYBOOK, cache_control: { type: "ephemeral" } },
        { type: "text", text: `Hoje é ${new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}. Lojas atendidas:\n${JSON.stringify(lojas)}` },
      ],
      tools: TOOLS,
      messages,
    });

    if (response.stop_reason === "refusal") {
      return { text: "Não consigo ajudar com esse pedido. Tente reformular.", proposals };
    }
    const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    const uses = response.content.filter((b) => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || !uses.length) {
      return { text: text || "Pronto.", proposals };
    }
    messages.push({ role: "assistant", content: response.content });
    const results = await Promise.all(
      uses.map(async (u) => {
        try {
          return { type: "tool_result", tool_use_id: u.id, content: JSON.stringify(await runTool(u.name, u.input || {}, proposals)) };
        } catch (e) {
          return { type: "tool_result", tool_use_id: u.id, content: e.message, is_error: true };
        }
      }),
    );
    messages.push({ role: "user", content: results });
  }
  return { text: "Esse pedido ficou longo demais. Tente dividir em partes menores.", proposals };
}
