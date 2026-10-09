// Meta Marketing API (Facebook + Instagram).
// Usa o token de Usuário do Sistema do Business Manager da consultoria (META_ACCESS_TOKEN).
// Cada loja aponta para a sua conta de anúncio em client.metaAdAccountId.
import { store } from "../store.js";
import { lerImagem } from "../imagens.js";

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

// Objetivos que um restaurante usa, no formato que a Meta pede (campanha → conjunto → anúncio).
export const META_OBJETIVOS = {
  whatsapp: { rotulo: "Pedidos pelo WhatsApp", objective: "OUTCOME_ENGAGEMENT", otimizacao: "CONVERSATIONS", destino: "WHATSAPP" },
  trafego: { rotulo: "Visitas ao site, cardápio ou iFood", objective: "OUTCOME_TRAFFIC", otimizacao: "LINK_CLICKS", destino: "WEBSITE" },
  alcance: { rotulo: "Ser visto no bairro (alcance)", objective: "OUTCOME_AWARENESS", otimizacao: "REACH", destino: null },
};

function posicionamentos(lista) {
  if (!Array.isArray(lista) || !lista.length) return {}; // automático (Advantage+)
  const fb = [], ig = [];
  if (lista.includes("feed")) { fb.push("feed"); ig.push("stream"); }
  if (lista.includes("stories")) { fb.push("story"); ig.push("story"); }
  if (lista.includes("reels")) { fb.push("facebook_reels"); ig.push("reels"); }
  return { publisher_platforms: ["facebook", "instagram"], facebook_positions: fb, instagram_positions: ig };
}

// Interesses digitados em português viram os interesses oficiais da Meta (o mais próximo de cada um).
async function interesses(lista) {
  const achados = [];
  for (const q of (lista || []).slice(0, 10)) {
    const r = await graph("GET", "/search", { type: "adinterest", q, locale: "pt_BR", limit: "1" }).catch(() => ({}));
    if (r.data?.[0]) achados.push({ id: r.data[0].id, name: r.data[0].name });
  }
  return achados.length ? { flexible_spec: [{ interests: achados }] } : {};
}

// Páginas do Facebook (e o Instagram ligado a cada uma) que o token enxerga.
export async function paginasMeta() {
  const r = await graph("GET", "/me/accounts", { fields: "id,name,instagram_business_account{id,username}", limit: "100" });
  return (r.data || []).map((p) => ({ id: p.id, nome: p.name, instagramId: p.instagram_business_account?.id || "", instagram: p.instagram_business_account?.username || "" }));
}

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
    // Finalizar = arquivar: a campanha para de gastar e não pode ser reativada.
    async finalize(id) {
      await graph("POST", `/${id}`, { status: "ARCHIVED" });
    },
    async setDailyBudget(id, reais) {
      // Só funciona em campanhas com orçamento na campanha (CBO).
      await graph("POST", `/${id}`, { daily_budget: String(Math.round(reais * 100)) });
    },
    // Cria campanha, conjunto (público) e anúncio, tudo PAUSADO, como no Gerenciador de Anúncios.
    async createCampaign(d) {
      const client = store.get().clients.find((c) => c.id === d.clientId);
      if (!client?.metaAdAccountId) throw new Error("Essa loja ainda não tem conta de anúncio Meta cadastrada.");
      const conta = act(client.metaAdAccountId);
      const obj = META_OBJETIVOS[d.objetivo] || META_OBJETIVOS.whatsapp;
      const img = lerImagem(d.imagemId);
      const { images } = await graph("POST", `/${conta}/adimages`, { bytes: img.base64, name: img.nome });
      const imageHash = Object.values(images || {})[0]?.hash;
      if (!imageHash) throw new Error("Meta: a imagem não foi aceita.");
      const camp = await graph("POST", `/${conta}/campaigns`, {
        name: d.nome, objective: obj.objective, status: "PAUSED", special_ad_categories: [],
        daily_budget: String(Math.round(d.orcamento * 100)), bid_strategy: "LOWEST_COST_WITHOUT_CAP",
      });
      try {
        const brasil = d.area === "brasil";
        const local = brasil ? null : client.lat != null
          ? { latitude: client.lat, longitude: client.lng, radius: Number(d.raio) || 5, distance_unit: "kilometer" }
          : { address_string: client.endereco, radius: Number(d.raio) || 5, distance_unit: "kilometer" };
        if (!brasil && !local.latitude && !local.address_string) throw new Error("Cadastre o endereço da loja (Lojas e contas) para anunciar no raio de entrega.");
        const targeting = {
          geo_locations: brasil ? { countries: ["BR"] } : { custom_locations: [local], location_types: ["home", "recent"] },
          ...(await interesses(d.interesses)),
          age_min: Number(d.idadeMin) || 18, age_max: Number(d.idadeMax) || 65,
          targeting_automation: { advantage_audience: 0 },
          ...posicionamentos(d.posicionamentos),
        };
        const adset = await graph("POST", `/${conta}/adsets`, {
          name: `${d.nome} · ${brasil ? "Brasil" : `${d.raio || 5} km`}`, campaign_id: camp.id, status: "PAUSED",
          billing_event: "IMPRESSIONS", optimization_goal: obj.otimizacao,
          ...(obj.destino ? { destination_type: obj.destino } : {}),
          ...(d.objetivo === "whatsapp" ? { promoted_object: { page_id: d.paginaId } } : {}),
          targeting,
        });
        const link = d.objetivo === "whatsapp" ? "https://api.whatsapp.com/send" : d.link;
        const cta = d.objetivo === "whatsapp" ? { type: "WHATSAPP_MESSAGE", value: { app_destination: "WHATSAPP" } } : { type: d.botao || "ORDER_NOW", value: { link } };
        const creative = await graph("POST", `/${conta}/adcreatives`, {
          name: d.nome,
          object_story_spec: {
            page_id: d.paginaId,
            ...(d.instagramId ? { instagram_user_id: d.instagramId } : {}),
            link_data: { image_hash: imageHash, link, message: d.texto, name: d.titulo || undefined, description: d.descricao || undefined, call_to_action: cta },
          },
        });
        await graph("POST", `/${conta}/ads`, { name: d.nome, adset_id: adset.id, creative: { creative_id: creative.id }, status: "PAUSED" });
      } catch (e) {
        // Não deixa campanha pela metade na conta.
        await graph("DELETE", `/${camp.id}`).catch(() => {});
        throw e;
      }
      return { id: `meta:${camp.id}`, observacao: "Criada PAUSADA com público e anúncio. Revise e toque em Reativar para começar a rodar." };
    },
  };
}
