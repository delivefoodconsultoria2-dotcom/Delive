// Escolhe, por plataforma, a conexão real (quando há credenciais) ou o modo exemplo.
import { mockProvider } from "./mock.js";
import { metaProvider } from "./meta.js";
import { googleProvider } from "./google.js";

const hasMeta = () => Boolean(process.env.META_ACCESS_TOKEN);
const hasGoogle = () =>
  ["GOOGLE_ADS_CLIENT_ID", "GOOGLE_ADS_CLIENT_SECRET", "GOOGLE_ADS_REFRESH_TOKEN"].every((k) => process.env[k]);

export function provider(platform) {
  if (platform === "meta") return hasMeta() ? metaProvider() : mockProvider("meta");
  if (platform === "google") return hasGoogle() ? googleProvider() : mockProvider("google");
  throw new Error("Plataforma desconhecida: " + platform);
}

export const PLATFORMS = ["meta", "google"];

export function platformOf(campaignId) {
  return String(campaignId).split(":")[0];
}

export function externalId(campaignId) {
  return String(campaignId).split(":").slice(1).join(":");
}

export function connections() {
  return { meta: hasMeta(), google: hasGoogle() };
}
