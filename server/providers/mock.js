// Provedor de exemplo: usado quando a plataforma ainda não tem credenciais.
// Nenhuma chamada sai do servidor e nenhum dinheiro é gasto.
import { store } from "../store.js";

const SEED_CLIENTS = [
  { id: "zeburger", nome: "Zé Burger", cidade: "Campinas · 3 lojas", cor: "#D9480F", ticket: 48, metaAdAccountId: "", googleCustomerId: "" },
  { id: "bella", nome: "Bella Napoli Pizzaria", cidade: "São Paulo · Moema", cor: "#2B8A3E", ticket: 92, metaAdAccountId: "", googleCustomerId: "" },
  { id: "kaze", nome: "Sushi Kaze", cidade: "Curitiba · Batel", cor: "#C2255C", ticket: 130, metaAdAccountId: "", googleCustomerId: "" },
  { id: "acai", nome: "Açaí Tropical", cidade: "Santos · 2 lojas", cor: "#7048E8", ticket: 32, metaAdAccountId: "", googleCustomerId: "" },
  { id: "casamae", nome: "Marmitaria Casa Mãe", cidade: "Belo Horizonte", cor: "#1971C2", ticket: 26, metaAdAccountId: "", googleCustomerId: "" },
];

const C = (id, clientId, plataforma, canal, nome, objetivo, status, orcamento, gasto7, impressoes, cliques, pedidos, ticket, serie) => ({
  id, clientId, plataforma, canal, nome, objetivo, status, orcamento, gasto7, impressoes, cliques, pedidos,
  receita: Math.round(pedidos * ticket), serie, exemplo: true,
});

const SEED_CAMPAIGNS = [
  C("meta:c1", "zeburger", "meta", "Instagram + Facebook", "Combo Smash · raio 5 km", "Pedidos no WhatsApp", "ativa", 80, 532, 61400, 1840, 142, 48, [70, 74, 78, 80, 79, 76, 75]),
  C("google:c2", "zeburger", "google", "Pesquisa", "Hambúrguer delivery Campinas", "Pedidos no iFood", "ativa", 50, 331, 8900, 980, 96, 52, [44, 47, 48, 50, 49, 47, 46]),
  C("meta:c3", "bella", "meta", "Instagram", "Rodízio de quinta · Reels", "Mensagens", "ativa", 60, 402, 48200, 1210, 58, 95, [55, 57, 60, 58, 59, 56, 57]),
  C("google:c4", "bella", "google", "Performance Max", "Pizza Moema PMax", "Pedidos no site", "pausada", 70, 210, 15100, 520, 21, 88, [68, 70, 72, 0, 0, 0, 0]),
  C("meta:c5", "kaze", "meta", "Instagram + Facebook", "Combinado 40 peças", "Pedidos no WhatsApp", "ativa", 120, 846, 72300, 1420, 39, 140, [110, 118, 125, 120, 124, 126, 123]),
  C("google:c6", "kaze", "google", "Pesquisa", "Sushi delivery Batel", "Pedidos no iFood", "ativa", 40, 276, 5200, 610, 44, 120, [38, 40, 41, 39, 40, 38, 40]),
  C("meta:c7", "acai", "meta", "Instagram", "Açaí 700 ml em dobro", "Pedidos no iFood", "ativa", 35, 241, 39800, 1690, 121, 32, [33, 34, 35, 35, 34, 35, 35]),
  C("meta:c8", "casamae", "meta", "Facebook", "Marmita fitness semanal", "Cadastro (lead)", "em_analise", 45, 0, 0, 0, 0, 25, [0, 0, 0, 0, 0, 0, 0]),
  C("google:c9", "casamae", "google", "Pesquisa", "Marmita delivery BH", "Ligações", "ativa", 30, 198, 4100, 450, 63, 27, [27, 28, 29, 30, 28, 29, 27]),
];

export function seedIfEmpty() {
  store.update((d) => {
    if (!d.clients.length) d.clients = structuredClone(SEED_CLIENTS);
    if (!d.mockCampaigns) d.mockCampaigns = structuredClone(SEED_CAMPAIGNS);
  });
}

function find(platform, id) {
  const c = store.get().mockCampaigns.find((x) => x.id === `${platform}:${id}`);
  if (!c) throw new Error("Campanha não encontrada: " + id);
  return c;
}

export function mockProvider(platform) {
  return {
    name: platform,
    live: false,
    async listCampaigns() {
      return store.get().mockCampaigns.filter((c) => c.plataforma === platform);
    },
    async setStatus(id, status) {
      store.update(() => { find(platform, id).status = status; });
    },
    async setDailyBudget(id, reais) {
      store.update(() => { find(platform, id).orcamento = reais; });
    },
    async createCampaign(d) {
      const c = C(`${platform}:${store.id("c")}`, d.clientId, platform, d.canal, d.nome, d.objetivo, "em_analise", d.orcamento, 0, 0, 0, 0, 40, [0, 0, 0, 0, 0, 0, 0]);
      store.update((db) => { db.mockCampaigns.push(c); });
      return c;
    },
  };
}
