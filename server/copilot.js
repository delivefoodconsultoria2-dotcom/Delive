// Gestor de tráfego IA: Claude com ferramentas que leem as campanhas e
// PROPÕEM mudanças. Nenhuma ferramenta gasta dinheiro: as propostas voltam
// para a tela e só são aplicadas quando a pessoa toca em "Confirmar".
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { campaigns, propose } from "./actions.js";
import { store } from "./store.js";
import { ROOT } from "./paths.js";

const client = new Anthropic();
const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";
const EFFORT = process.env.CLAUDE_EFFORT || "medium";

// Base de conhecimento da Delivefood (server/knowledge). Vai inteira no prompt, em cache.
const BASE = JSON.parse(fs.readFileSync(path.join(ROOT, "server", "knowledge", "base-trafego-delivery.json"), "utf8"));
const { dados_para_treinamento_supervisionado: _treino, ...BASE_PROMPT } = BASE;

const PLAYBOOK = `${BASE.configuracao_do_especialista.prompt_base}

Você trabalha dentro do TrafgFood, o sistema de tráfego pago da Delivefood Consultoria, que atende vários restaurantes. Quem fala com você pode não saber tráfego pago: explique sem jargão (se usar um termo como ROAS ou CPA, explique em meia frase) e termine sempre com a próxima ação concreta e a métrica que vai decidir se ela continua, muda ou para.

Tamanho da resposta: por padrão até 8 linhas, porque pode ser lida em voz alta. Use o formato completo da base (Diagnóstico, Objetivo e hipótese, Estratégia por canal, ...) só quando pedirem um plano, diagnóstico completo ou estratégia de uma loja.

Fonte de verdade: a BASE DE CONHECIMENTO DELIVEFOOD abaixo. Siga os princípios, a árvore de diagnóstico, as fórmulas de decisão, as regras de escala e as regras para respostas da IA. Não use benchmarks fixos de mercado: calcule ROAS de equilíbrio e CPA máximo da loja com as fórmulas da base. Quando a margem da loja não estiver cadastrada, diga que é hipótese, use a margem informada pela pessoa ou peça o dado.

Como agir no sistema:
- Use buscar_campanhas para ver números antes de opinar sobre uma loja. Os resultados já trazem roas_equilibrio, cpa_maximo e margem_apos_midia_estimada quando a loja tem ticket e margem cadastrados.
- Para pausar, reativar, mudar orçamento ou criar campanha, use as ferramentas propor_*. Elas NÃO executam: criam uma proposta que a pessoa confirma na tela. Diga "deixei pronto para você confirmar", nunca "fiz".
- Nunca proponha aumentar orçamento de campanha sem conversão medida ou com ROAS abaixo do equilíbrio da loja.
- Se o pedido servir para mais de uma campanha e não estiver claro qual, pergunte antes.
- Receita marcada como estimada (pedidos × ticket) não é prova de lucro; avise quando isso importar.

BASE DE CONHECIMENTO DELIVEFOOD (dados de referência, versão ${BASE.metadata.versao}):
${JSON.stringify(BASE_PROMPT)}`;

const TOOLS = [
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
    name: "propor_orcamento",
    description: "Cria uma proposta para mudar o orçamento diário (em reais) de uma campanha. A pessoa confirma na tela.",
    input_schema: {
      type: "object",
      properties: { campanha_id: { type: "string" }, orcamento_dia: { type: "number" }, motivo: { type: "string" } },
      required: ["campanha_id", "orcamento_dia"],
    },
  },
  {
    name: "propor_campanha",
    description: "Cria uma proposta de campanha nova (nasce pausada na plataforma). formato: Instagram + Facebook, Instagram, Facebook, Pesquisa ou Performance Max. objetivo: Pedidos no WhatsApp, Pedidos no iFood, Pedidos no site, Mensagens, Cadastro (lead) ou Alcance local.",
    input_schema: {
      type: "object",
      properties: {
        loja_id: { type: "string" },
        plataforma: { type: "string", enum: ["meta", "google"] },
        formato: { type: "string" },
        nome: { type: "string" },
        objetivo: { type: "string" },
        orcamento_dia: { type: "number" },
        raio_km: { type: "number" },
        publico: { type: "string" },
        texto_anuncio: { type: "string" },
      },
      required: ["loja_id", "plataforma", "nome", "orcamento_dia"],
    },
  },
];

function resumoCampanha(c) {
  return {
    id: c.id,
    loja_id: c.clientId,
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

async function runTool(name, input, proposals) {
  switch (name) {
    case "buscar_campanhas": {
      const { data } = await campaigns();
      return data
        .filter((c) => (!input.loja_id || c.clientId === input.loja_id) && (!input.plataforma || c.plataforma === input.plataforma))
        .map(resumoCampanha);
    }
    case "propor_pausa":
    case "propor_reativar":
    case "propor_orcamento": {
      const tipo = { propor_pausa: "pausar", propor_reativar: "ativar", propor_orcamento: "orcamento" }[name];
      const a = await propose({ tipo, campanhaId: String(input.campanha_id), dados: { orcamento: input.orcamento_dia, motivo: input.motivo }, origem: "gestor IA" });
      proposals.push(a);
      return { proposta: a.id, situacao: "aguardando confirmação da pessoa na tela" };
    }
    case "propor_campanha": {
      const plataforma = input.plataforma === "google" ? "google" : "meta";
      const a = await propose({
        tipo: "criar",
        dados: {
          clientId: String(input.loja_id),
          plataforma,
          canal: String(input.formato || (plataforma === "google" ? "Pesquisa" : "Instagram + Facebook")),
          nome: String(input.nome),
          objetivo: String(input.objetivo || "Pedidos no WhatsApp"),
          orcamento: Number(input.orcamento_dia),
          raio: Number(input.raio_km) || 5,
          publico: String(input.publico || ""),
          texto: String(input.texto_anuncio || ""),
        },
        origem: "gestor IA",
      });
      proposals.push(a);
      return { proposta: a.id, situacao: "aguardando confirmação da pessoa na tela" };
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
    const response = await client.beta.messages.create({
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
