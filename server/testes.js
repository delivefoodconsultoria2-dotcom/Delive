// Botão "Testar" da tela Configurações: confere cada conexão sem gastar nada.
import Anthropic from "@anthropic-ai/sdk";
import { accessToken, resetGoogleToken } from "./providers/google.js";

const digits = (v) => String(v || "").replace(/\D/g, "");

export async function testar(grupo) {
  const E = process.env;
  if (grupo === "claude") {
    if (!E.ANTHROPIC_API_KEY) throw new Error("Falta a chave da Claude API.");
    try {
      await new Anthropic({ apiKey: E.ANTHROPIC_API_KEY }).models.list({ limit: 1 });
    } catch (e) {
      if (e.status === 401) throw new Error("A Anthropic recusou a chave. Gere outra em console.anthropic.com > API Keys.");
      throw new Error("Não consegui falar com a Anthropic: " + e.message);
    }
    return "Chave aceita. O gestor IA está ligado. Confira se há crédito em console.anthropic.com > Billing.";
  }
  if (grupo === "google") {
    for (const [k, n] of [["GOOGLE_ADS_CLIENT_ID", "Client ID"], ["GOOGLE_ADS_CLIENT_SECRET", "Client Secret"], ["GOOGLE_ADS_REFRESH_TOKEN", "Refresh token"]])
      if (!E[k]) throw new Error(`Falta o ${n}.`);
    resetGoogleToken();
    const tk = await accessToken();
    const headers = { Authorization: `Bearer ${tk}` };
    if (E.GOOGLE_ADS_DEVELOPER_TOKEN) headers["developer-token"] = E.GOOGLE_ADS_DEVELOPER_TOKEN;
    const v = E.GOOGLE_ADS_API_VERSION || "v21";
    const res = await fetch(`https://googleads.googleapis.com/${v}/customers:listAccessibleCustomers`, { headers });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      const det = j.error?.details?.[0]?.errors?.[0]?.message || j.error?.message || res.statusText;
      throw new Error("Login do Google OK, mas a Google Ads API recusou: " + det);
    }
    const ids = (j.resourceNames || []).map((r) => r.split("/")[1]);
    const mcc = digits(E.GOOGLE_ADS_LOGIN_CUSTOMER_ID);
    const aviso = mcc && !ids.includes(mcc) ? ` A conta ${E.GOOGLE_ADS_LOGIN_CUSTOMER_ID} não está entre elas: confira o ID da MCC.` : "";
    return `Conectado. Este login enxerga ${ids.length} conta${ids.length === 1 ? "" : "s"} do Google Ads.${aviso}`;
  }
  if (grupo === "meta") {
    if (!E.META_ACCESS_TOKEN) throw new Error("Falta o token de acesso.");
    const v = E.META_API_VERSION || "v23.0";
    const res = await fetch(`https://graph.facebook.com/${v}/me/adaccounts?fields=name&limit=200`, { headers: { Authorization: `Bearer ${E.META_ACCESS_TOKEN}` } });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.error) throw new Error("A Meta recusou o token: " + (j.error?.message || res.statusText));
    const n = (j.data || []).length;
    return `Conectado. O token enxerga ${n} conta${n === 1 ? "" : "s"} de anúncio.`;
  }
  if (grupo === "acesso") return process.env.APP_PASSWORD ? "Senha ativa." : "Sem senha: entra direto.";
  throw new Error("Conexão desconhecida.");
}
