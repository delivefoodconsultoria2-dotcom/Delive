// Google Ads API (REST). Opera as contas dos restaurantes pela MCC da consultoria.
// Cada loja aponta para a sua conta em client.googleCustomerId (só números).
import { store } from "../store.js";

// O Google desliga cada versão da API cerca de um ano depois; uma versão desligada responde 404.
// Tenta as versões em uso e guarda a que funcionou.
const CANDIDATAS = ["v24", "v23", "v22", "v25"];
const FIXA = process.env.GOOGLE_ADS_API_VERSION || null;
let versao = null; // última versão que respondeu com sucesso

export async function googleFetch(path, init) {
  const lista = FIXA ? [FIXA] : [...new Set([versao, ...CANDIDATAS].filter(Boolean))];
  let res;
  for (const v of lista) {
    res = await fetch(`https://googleads.googleapis.com/${v}/${path}`, init);
    if (res.ok) versao = v;
    if (res.status !== 404 && res.status !== 501) return res;
  }
  return res;
}

const CANAL = { SEARCH: "Pesquisa", PERFORMANCE_MAX: "Performance Max", DISPLAY: "Display", LOCAL: "Local", SMART: "Inteligente", VIDEO: "YouTube" };

let token = { value: null, exp: 0 };
export const resetGoogleToken = () => { token = { value: null, exp: 0 }; };

export async function accessToken() {
  if (token.value && Date.now() < token.exp - 60_000) return token.value;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_ADS_CLIENT_ID,
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error("Google: não consegui renovar o login (" + (json.error_description || json.error) + ")");
  token = { value: json.access_token, exp: Date.now() + json.expires_in * 1000 };
  return token.value;
}

const digits = (id) => String(id).replace(/\D/g, "");

async function call(customerId, pathname, body) {
  const headers = {
    Authorization: `Bearer ${await accessToken()}`,
    "Content-Type": "application/json",
  };
  // O Google vem flexibilizando o developer token; envia só quando estiver configurado.
  if (process.env.GOOGLE_ADS_DEVELOPER_TOKEN) headers["developer-token"] = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) headers["login-customer-id"] = digits(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID);
  const res = await googleFetch(`customers/${digits(customerId)}/${pathname}`, { method: "POST", headers, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = json.error?.details?.[0]?.errors?.[0]?.message || json.error?.message || res.statusText;
    throw new Error("Google Ads: " + detail);
  }
  return json;
}

async function search(customerId, query) {
  const rows = [];
  let pageToken;
  do {
    const r = await call(customerId, "googleAds:search", pageToken ? { query, pageToken } : { query });
    rows.push(...(r.results || []));
    pageToken = r.nextPageToken;
  } while (pageToken);
  return rows;
}

function split(id) {
  const [cid, campaignId] = id.split("-");
  return { cid, campaignId };
}

export function googleProvider() {
  return {
    name: "google",
    live: true,
    async listCampaigns() {
      const clients = store.get().clients.filter((c) => c.googleCustomerId);
      const out = [];
      for (const client of clients) {
        const cid = digits(client.googleCustomerId);
        const [base, daily] = await Promise.all([
          search(cid, `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign.primary_status, campaign_budget.amount_micros FROM campaign WHERE campaign.status != 'REMOVED'`),
          search(cid, `SELECT campaign.id, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value FROM campaign WHERE segments.date DURING LAST_7_DAYS AND campaign.status != 'REMOVED'`),
        ]);
        const dates = [...Array(7)].map((_, i) => new Date(Date.now() - (7 - i) * 864e5).toISOString().slice(0, 10));
        for (const row of base) {
          const c = row.campaign;
          const days = daily.filter((d) => d.campaign.id === c.id);
          const sum = (f) => days.reduce((s, d) => s + Number(f(d.metrics) || 0), 0);
          const conv = sum((m) => m.conversions);
          const valor = sum((m) => m.conversionsValue);
          out.push({
            id: `google:${cid}-${c.id}`,
            clientId: client.id,
            plataforma: "google",
            canal: CANAL[c.advertisingChannelType] || c.advertisingChannelType,
            nome: c.name,
            objetivo: "Conversões",
            status: c.status === "ENABLED" ? (c.primaryStatus === "PENDING" ? "em_analise" : "ativa") : "pausada",
            orcamento: row.campaignBudget?.amountMicros ? Number(row.campaignBudget.amountMicros) / 1e6 : null,
            gasto7: Math.round(sum((m) => m.costMicros) / 1e6),
            impressoes: sum((m) => m.impressions),
            cliques: sum((m) => m.clicks),
            pedidos: Math.round(conv),
            receita: Math.round(valor || conv * (client.ticket || 0)),
            receitaEstimada: !valor,
            serie: dates.map((dt) => Math.round(days.filter((d) => d.segments.date === dt).reduce((s, d) => s + Number(d.metrics.costMicros || 0), 0) / 1e6)),
          });
        }
      }
      return out;
    },
    async setStatus(id, status) {
      const { cid, campaignId } = split(id);
      await call(cid, "campaigns:mutate", {
        operations: [{ update: { resourceName: `customers/${cid}/campaigns/${campaignId}`, status: status === "ativa" ? "ENABLED" : "PAUSED" }, updateMask: "status" }],
      });
    },
    async setDailyBudget(id, reais) {
      const { cid, campaignId } = split(id);
      const [row] = await search(cid, `SELECT campaign_budget.resource_name FROM campaign WHERE campaign.id = ${digits(campaignId)}`);
      if (!row) throw new Error("Google Ads: campanha não encontrada");
      await call(cid, "campaignBudgets:mutate", {
        operations: [{ update: { resourceName: row.campaignBudget.resourceName, amountMicros: String(Math.round(reais * 1e6)) }, updateMask: "amount_micros" }],
      });
    },
    async createCampaign() {
      throw new Error("Criar campanha no Google Ads pelo TrafgFood ainda não está pronto. Crie no Google Ads e ela aparece aqui para gerenciar.");
    },
  };
}
