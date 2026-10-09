// Dicas do especialista para cada passo da criação de campanha, tiradas das bases de conhecimento.
// Foco "comida" usa a base de restaurantes; foco "servico" usa a base de venda de serviços (quando existir).
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./paths.js";

const ler = (arq) => {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, "server", "knowledge", arq), "utf8")); } catch { return null; }
};
export const BASES = { comida: ler("base-trafego-delivery.json"), servico: ler("base-trafego-servicos.json") };

const PADRAO = {
  comida: {
    objetivo: {
      whatsapp: "Bom para quem fecha pedido no WhatsApp. Meça conversas que viram pedido, não só conversas.",
      trafego: "Leva para o iFood, cardápio ou site. Use o link direto do produto anunciado.",
      alcance: "Só para lançamento ou inauguração. Não espere pedidos diretos.",
    },
    publico: "Comece pelo raio que a entrega atende de verdade, idade aberta e sem interesses: a Meta acha quem pede. Só restrinja se os dados mostrarem.",
    posicionamentos: "Automático costuma ter o menor custo. Se o vídeo for vertical 9:16, Reels e Stories rendem muito para comida.",
    foto: "Comida real, de perto, com textura e porção fiéis. O produto aparece logo, não a logomarca.",
    texto: "Gancho + produto + prova + oferta + chamada. Exemplo: \"Seu jantar de hoje está resolvido. Smash duplo com fritas, 4,9 no iFood. Peça agora.\"",
    orcamento: "Comece com um valor que gere dados sem passar da perda que você aceita. Aumente aos poucos (até 20%) só quando houver pedidos e margem.",
    palavras: "Use termos de quem quer comer agora: \"hamburguer delivery\", \"pizza perto de mim\", \"marmita [bairro]\". Evite palavras genéricas soltas.",
    titulos: "Até 30 letras cada. Misture produto, bairro, prazo e prova: \"Pizza em 30 min no Batel\".",
    descricoes: "Até 90 letras. Diga a oferta e o próximo passo: \"Peça pelo cardápio online e receba quentinho. Frete grátis hoje.\"",
  },
  servico: {
    objetivo: {
      whatsapp: "O melhor para serviço: a pessoa conversa direto com você. Responda rápido (minutos) e qualifique na conversa.",
      trafego: "Leva para o seu site ou página de captura. Funciona quando a página tem formulário ou botão de WhatsApp bem visível.",
      alcance: "Só para fazer a marca conhecida na região. Não espere contatos.",
    },
    publico: "Para vender a donos de restaurante: Brasil inteiro ou suas cidades, 25 a 60 anos, interesses como \"iFood\", \"Restaurante\", \"Delivery\", \"Empreendedorismo\". Teste também sem interesses.",
    posicionamentos: "Automático para começar. Se usar vídeo seu explicando o método, Reels e Stories costumam trazer contatos mais baratos.",
    foto: "Mostre você, um resultado real de cliente (com autorização) ou um print de painel com crescimento. Rosto e prova vendem serviço.",
    texto: "Dor + promessa + prova + oferta de entrada + chamada. Exemplo: \"Seu delivery vende, mas não sobra dinheiro? Faço um diagnóstico grátis do seu iFood e mostro onde está o lucro. Chame no WhatsApp.\"",
    orcamento: "Defina o custo por contato que você aguenta: ticket do serviço × margem × taxa de fechamento. Comece baixo e aumente quando os contatos virarem reuniões.",
    palavras: "Use termos de quem procura ajuda: \"consultoria para delivery\", \"como vender mais no ifood\", \"gestão de restaurante\", \"tráfego pago para restaurante\".",
    titulos: "Até 30 letras. Prometa resultado e prova: \"Consultoria para Delivery\", \"Diagnóstico Grátis do iFood\".",
    descricoes: "Até 90 letras. Oferta de entrada clara: \"Analisamos seu cardápio, preços e anúncios e mostramos onde aumentar o lucro.\"",
  },
};

export function dicasCriacao(foco) {
  const base = BASES[foco] || BASES.comida;
  const fc = base?.framework_de_criativos || {};
  return {
    foco,
    baseCarregada: Boolean(BASES[foco]),
    ...PADRAO[foco],
    ganchos: fc.ganchos || [],
    exemplos: fc.exemplos_de_textos || [],
  };
}
