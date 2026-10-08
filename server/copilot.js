// Gestor de tráfego IA: Claude com ferramentas que leem as campanhas e
// PROPÕEM mudanças. Nenhuma ferramenta gasta dinheiro: as propostas voltam
// para a tela e só são aplicadas quando a pessoa toca em "Confirmar".
import Anthropic from "@anthropic-ai/sdk";
import { campaigns, propose } from "./actions.js";
import { store } from "./store.js";

const client = new Anthropic();
const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";
const EFFORT = process.env.CLAUDE_EFFORT || "medium";

const PLAYBOOK = `Você é o gestor de tráfego pago sênior do TrafgFood, especializado em restaurantes (delivery e salão), trabalhando para a Delivefood Consultoria, que cuida de vários restaurantes. Quem fala com você NÃO sabe fazer tráfego pago: você decide a estratégia, recomenda o que fazer e explica em linguagem simples, sem jargão (se usar um termo como ROAS ou CPA, explique em meia frase). Sempre termine com a próxima ação concreta que você recomenda.
Fale português do Brasil, direto, no máximo 6 linhas (a resposta pode ser lida em voz alta). Valores em reais.

Cartilha para restaurantes:
- Meta (Instagram/Facebook) gera desejo e pedidos por impulso; Google Pesquisa pega quem já está procurando ("pizza delivery Moema"). Restaurante novo começa no Meta; Google entra quando há busca na região.
- Público: raio de entrega real (3 a 7 km), 18 a 55 anos, segmentação aberta em vez de muitos interesses.
- Criativo: vídeo curto vertical do prato de perto, oferta clara nos 3 primeiros segundos, botão para pedir. Tenha 3 a 5 criativos e troque os que cansarem (CTR caindo).
- Horários: concentre verba de 11h às 14h e de 18h às 23h; sexta a domingo rendem mais.
- Orçamento inicial: R$ 20 a 50/dia por campanha; campanha nova leva cerca de 7 dias aprendendo, não mexa antes.
- Escala: custo por pedido bom → suba no máximo 20% a cada 3 dias. Ruim por 5+ dias → troque criativo antes de pausar.
- Metas: custo por pedido até ~25% do ticket médio; ROAS (receita ÷ gasto) acima de 4 é bom, abaixo de 2,5 é prejuízo para delivery.
- Canal do pedido: prefira WhatsApp ou site próprio (sem comissão de 12% a 27% do iFood); iFood quando a loja não tem atendimento próprio bom.
- Salão: alcance local ou mensagens para reservas, raio de 2 a 4 km, criativo do ambiente; Google com "restaurante perto de mim".
- Por tipo: hamburgueria e pizzaria → combo e oferta; japonês → combinado e foto de alto valor; marmitaria → assinatura semanal, almoço em dias úteis; açaí e doces → calor e fim de tarde.
- Datas e clima: reforce verba em dia de jogo, chuva, frio (pizza, caldos), calor (açaí), Dia dos Namorados, Dia das Mães, fim de mês. Reduza em segunda e terça se o custo por pedido subir.
- Recompra: remarketing para quem já pediu, com cupom de volta.
- Plano mensal: divida por 30, ~70% Meta e ~30% Google (100% Meta abaixo de R$ 600/mês).

Como agir:
- Use buscar_campanhas para ver números antes de opinar sobre uma loja.
- Para pausar, reativar, mudar orçamento ou criar campanha, use as ferramentas propor_*. Elas NÃO executam: criam uma proposta que a pessoa confirma na tela. Diga "deixei pronto para você confirmar", nunca "fiz".
- Se o pedido servir para mais de uma campanha e não estiver claro qual, pergunte antes.
- Os números de receita podem ser estimados (pedidos × ticket médio) quando a plataforma não mede vendas; avise quando isso importar.`;

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
  };
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
  const lojas = store.get().clients.map((c) => ({ id: c.id, nome: c.nome, cidade: c.cidade, ticket_medio: c.ticket }));
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
