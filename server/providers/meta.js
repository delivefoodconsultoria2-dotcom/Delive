// Meta Marketing API (Facebook + Instagram).
// Usa o token de Usuário do Sistema do Business Manager da consultoria (META_ACCESS_TOKEN).
// Cada loja aponta para a sua conta de anúncio em client.metaAdAccountId.
import { store } from "../store.js";

const VERSION = process.env.META_API_VERSION || "v23.0";
const BASE = `https://graph.facebook.com/${VERSION}`;

const PURCHASE = ["purchase", "offsite_conversion.fb_pixel_purchase", "omni_purchase"];
const MESSAGES = ["onsite_conversion.messaging_conversation_started_7d"];
const LEADS = ["lead", "onsite_conversion.lead_grouped"];

const OBJECTIVE = {
  "Pedidos no WhatsApp": "OUTCOME_ENGAGEMENT",
  "Mensagens": "OUTCOME_ENGAGEMENT",
  "Pedidos no iFood": "OUTCOME_TRAFFIC",
  "Pedidos no site": "OUTCOME_SALES",
  "Cadastro (lead)": "OUTCOME_LEADS",
  "Alcance local": "OUTCOME_AWARENESS",
};

function act(id) {
  return String(id).startsWith("act_") ? id : `act_${id}`;
}

async function graph(method, pathname, params = {}) {
  const url = new URL(BASE + pathname);
  const body = new URLSearchParams();
  const target = method === "GET" ? url.searchParams : body;
  for (const [k, v] of Object.entries(params)) target.set(k, typeof v === "string" ? v : JSON.stringify(v));
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}` },
    body: method === "GET" ? undefined : body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    const e = json.error || {};
    throw new Error(`Meta: ${e.error_user_msg || e.message || res.statusText}`);
  }
  return json;
}

async function all(pathname, params) {
  const out = [];
  let page = await graph("GET", pathname, { limit: "200", ...params });
  out.push(...(page.data || []));
  while (page.paging?.next) {
    const res = await fetch(page.paging.next, { headers: { Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}` } });
    page = await res.json();
    out.push(...(page.data || []));
  }
  return out;
}

const sumActions = (list, types) =>
  (list || []).filter((a) => types.includes(a.action_type)).reduce((s, a) => s + Number(a.value || 0), 0);

function mapStatus(effective) {
  if (effective === "ACTIVE") return "ativa";
  if (["PAUSED", "CAMPAIGN_PAUSED", "ADSET_PAUSED", "ARCHIVED"].includes(effective)) return "pausada";
  return "em_analise";
}

export function metaProvider() {
  return {
    name: "meta",
    live: true,
    async listCampaigns() {
      const clients = store.get().clients.filter((c) => c.metaAdAccountId);
      const out = [];
      for (const client of clients) {
        const account = act(client.metaAdAccountId);
        const [campaigns, insights] = await Promise.all([
          all(`/${account}/campaigns`, { fields: "id,name,objective,effective_status,daily_budget,lifetime_budget" }),
          all(`/${account}/insights`, {
            level: "campaign",
            date_preset: "last_7d",
            time_increment: "1",
            fields: "campaign_id,spend,impressions,clicks,actions,action_values,date_start",
          }),
        ]);
        for (const c of campaigns) {
          if (c.effective_status === "DELETED" || c.effective_status === "ARCHIVED") continue;
          const days = insights.filter((i) => i.campaign_id === c.id).sort((a, b) => a.date_start.localeCompare(b.date_start));
          const serie = days.map((d) => Math.round(Number(d.spend || 0))).slice(-7);
          while (serie.length < 7) serie.unshift(0);
          const tot = (f) => days.reduce((s, d) => s + f(d), 0);
          const compras = tot((d) => sumActions(d.actions, PURCHASE));
          const pedidos = compras || tot((d) => sumActions(d.actions, MESSAGES)) || tot((d) => sumActions(d.actions, LEADS));
          const receita = tot((d) => sumActions(d.action_values, PURCHASE)) || Math.round(pedidos * (client.ticket || 0));
          out.push({
            id: `meta:${c.id}`,
            clientId: client.id,
            plataforma: "meta",
            canal: "Instagram + Facebook",
            nome: c.name,
            objetivo: c.objective,
            status: mapStatus(c.effective_status),
            orcamento: c.daily_budget ? Number(c.daily_budget) / 100 : null,
            gasto7: Math.round(tot((d) => Number(d.spend || 0))),
            impressoes: tot((d) => Number(d.impressions || 0)),
            cliques: tot((d) => Number(d.clicks || 0)),
            pedidos,
            receita,
            receitaEstimada: !compras,
            serie,
          });
        }
      }
      return out;
    },
    async setStatus(id, status) {
      await graph("POST", `/${id}`, { status: status === "ativa" ? "ACTIVE" : "PAUSED" });
    },
    async setDailyBudget(id, reais) {
      // Só funciona em campanhas com orçamento na campanha (CBO).
      await graph("POST", `/${id}`, { daily_budget: String(Math.round(reais * 100)) });
    },
    async createCampaign(d) {
      const client = store.get().clients.find((c) => c.id === d.clientId);
      if (!client?.metaAdAccountId) throw new Error("Essa loja ainda não tem conta de anúncio Meta cadastrada.");
      // Nasce PAUSADA: o conjunto (público, raio) e o anúncio (criativo) entram antes de ligar.
      const r = await graph("POST", `/${act(client.metaAdAccountId)}/campaigns`, {
        name: d.nome,
        objective: OBJECTIVE[d.objetivo] || "OUTCOME_ENGAGEMENT",
        status: "PAUSED",
        special_ad_categories: [],
        daily_budget: String(Math.round(d.orcamento * 100)),
        bid_strategy: "LOWEST_COST_WITHOUT_CAP",
      });
      return { id: `meta:${r.id}`, observacao: "Campanha criada pausada. Falta adicionar público e criativo antes de ativar." };
    },
  };
}
