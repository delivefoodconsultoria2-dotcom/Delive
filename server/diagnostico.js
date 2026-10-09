// Diagnóstico automático, sem IA: aplica as fórmulas, a árvore de diagnóstico e as regras de escala
// da Base de Conhecimento Delivefood aos números de cada campanha. Só sugere; nada é aplicado.
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./paths.js";

const BASE = JSON.parse(fs.readFileSync(path.join(ROOT, "server", "knowledge", "base-trafego-delivery.json"), "utf8"));
const arvore = (trecho) => BASE.arvore_de_diagnostico.find((a) => a.sintoma.toLowerCase().includes(trecho.toLowerCase())) || { verificar: [], acoes: [] };
const brl = (v) => "R$ " + Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 0 });
const dec = (v) => Number(v).toFixed(1).replace(".", ",");
const arred5 = (v) => Math.max(6, Math.round(v / 5) * 5);

// CTR mínimo esperado por formato (referência prática para delivery; abaixo disso o anúncio não chama atenção).
const ctrMinimo = (c) => (c.plataforma === "google" ? (/pesquisa/i.test(c.canal) ? 3 : 0.8) : 0.9);

export function diagnosticar(campanhas, lojas) {
  const out = [];
  const loja = (id) => lojas.find((l) => l.id === id) || {};
  const ativas = campanhas.filter((c) => c.status === "ativa");

  for (const l of lojas) {
    if (ativas.some((c) => c.clientId === l.id) && !(Number(l.margem) > 0))
      out.push({ nivel: "atencao", loja: l.nome, lojaId: l.id, titulo: `Cadastre a margem da ${l.nome}`, porque: "Sem a margem de contribuição não dá para calcular o ROAS de equilíbrio nem saber se os anúncios dão lucro.", acoes: ["Em Lojas e contas, preencha a margem antes da mídia (o que sobra do pedido depois de CMV, embalagem, taxas, entrega e impostos)."] });
  }

  // CPM de referência por loja e plataforma, para achar CPM fora da curva.
  const cpm = (c) => (c.impressoes ? (c.gasto7 / c.impressoes) * 1000 : 0);
  const mediana = (arr) => { const a = arr.filter(Boolean).sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : 0; };

  for (const c of ativas) {
    const l = loja(c.clientId), mg = Number(l.margem) / 100;
    const eq = mg > 0 && mg < 1 ? 1 / mg : null;
    const cpaMax = eq && l.ticket ? l.ticket * mg : null;
    const roas = c.gasto7 ? c.receita / c.gasto7 : 0;
    const cpa = c.pedidos ? c.gasto7 / c.pedidos : null;
    const ctr = c.impressoes ? (c.cliques / c.impressoes) * 100 : 0;
    const conv = c.cliques ? (c.pedidos / c.cliques) * 100 : 0;
    const base = { campanhaId: c.id, campanha: c.nome, loja: l.nome, lojaId: c.clientId, plataforma: c.plataforma };
    const numeros = `${brl(c.gasto7)} em 7 dias, ${c.pedidos} pedidos${cpa ? `, ${brl(cpa)} por pedido` : ""}, ROAS ${dec(roas)}${eq ? ` (mínimo da loja ${dec(eq)})` : ""}.`;

    if (c.gasto7 >= Math.max(60, (cpaMax || 30) * 3) && c.pedidos === 0) {
      const a = arvore("cliques e poucos pedidos");
      out.push({ ...base, nivel: "grave", titulo: `${c.nome}: gastou ${brl(c.gasto7)} sem nenhum pedido`, porque: `${numeros} Ou a medição não está funcionando, ou a campanha não converte.`,
        verificar: ["se o pixel ou a conversão estão registrando pedidos", ...a.verificar.slice(0, 4)], acoes: ["Pausar até achar a causa", ...a.acoes.slice(0, 2)],
        proposta: { tipo: "pausar", rotulo: "Pausar campanha" } });
      continue;
    }
    if (eq && c.pedidos > 0 && roas < eq) {
      const novo = arred5((c.orcamento || 0) * 0.7);
      const a = conv < 2 && c.cliques > 50 ? arvore("cliques e poucos pedidos") : ctr < ctrMinimo(c) ? arvore("CTR baixo") : arvore("CPM alto");
      out.push({ ...base, nivel: "grave", titulo: `${c.nome} está dando prejuízo`, porque: `${numeros} Abaixo do equilíbrio, cada real investido devolve menos do que custa.`,
        verificar: a.verificar.slice(0, 4), acoes: [roas < eq * 0.6 ? "Pausar e corrigir antes de voltar" : `Reduzir o orçamento para ${c.orcamento ? brl(novo) : "menos"} por dia enquanto corrige`, ...a.acoes.slice(0, 2)],
        proposta: roas < eq * 0.6 || !c.orcamento ? { tipo: "pausar", rotulo: "Pausar campanha" } : { tipo: "orcamento", orcamento: novo, rotulo: `Reduzir para ${brl(novo)}/dia` } });
      continue;
    }
    if (c.cliques > 80 && conv < 2) {
      const a = arvore("cliques e poucos pedidos");
      out.push({ ...base, nivel: "atencao", titulo: `${c.nome}: muitos cliques e poucos pedidos`, porque: `${c.cliques} cliques viraram ${c.pedidos} pedidos (${dec(conv)}%). O problema está depois do clique.`, verificar: a.verificar.slice(0, 5), acoes: a.acoes });
    } else if (c.impressoes > 2000 && ctr < ctrMinimo(c)) {
      const a = arvore("CTR baixo");
      out.push({ ...base, nivel: "atencao", titulo: `${c.nome}: anúncio chama pouca atenção`, porque: `CTR de ${dec(ctr)}% (referência acima de ${dec(ctrMinimo(c))}%).`, verificar: a.verificar, acoes: a.acoes });
    }
    const ref = mediana(ativas.filter((x) => x.plataforma === c.plataforma).map(cpm));
    if (ref && cpm(c) > ref * 1.6 && c.impressoes > 2000) {
      const a = arvore("CPM alto");
      out.push({ ...base, nivel: "atencao", titulo: `${c.nome}: impressões caras`, porque: `CPM de ${brl(cpm(c))}, bem acima das outras campanhas (${brl(ref)}).`, verificar: a.verificar, acoes: a.acoes });
    }
    if (eq && c.pedidos >= 15 && roas >= eq * 1.8 && (!cpaMax || (cpa && cpa <= cpaMax)) && c.orcamento) {
      const novo = arred5(c.orcamento * 1.2);
      out.push({ ...base, nivel: "oportunidade", titulo: `${c.nome} pode receber mais verba`, porque: `${numeros} Bem acima do equilíbrio${cpaMax ? ` e com custo por pedido abaixo do máximo (${brl(cpaMax)})` : ""}.`,
        verificar: ["capacidade da cozinha e da entrega no horário de pico", "frequência e se o resultado se mantém após o aumento"],
        acoes: [`Aumentar 20%, para ${brl(novo)} por dia, e reavaliar em 3 a 4 dias`, ...BASE.regras_de_escala.slice(0, 2)],
        proposta: { tipo: "orcamento", orcamento: novo, rotulo: `Aumentar para ${brl(novo)}/dia` } });
    }
  }
  const ordem = { grave: 0, atencao: 1, oportunidade: 2 };
  return { itens: out.sort((a, b) => ordem[a.nivel] - ordem[b.nivel]), rotina: BASE.rotina_de_otimizacao };
}
