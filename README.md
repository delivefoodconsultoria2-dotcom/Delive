# TrafgFood

Tráfego pago Meta (Facebook e Instagram) e Google Ads para restaurantes, da Delivefood Consultoria.
Painel por loja, campanhas, gestor de tráfego IA por voz e texto, e confirmação antes de qualquer mudança que gaste dinheiro.

## Como funciona

- **Servidor** (`server/`): guarda as lojas, lê as campanhas nas plataformas e aplica mudanças. As chaves das plataformas ficam só aqui.
- **App** (`web/`): abre no navegador do PC e do celular e pode ser instalado como aplicativo (botão "Instalar" do Chrome/Edge ou "Adicionar à tela de início" no celular).
- **Gestor de tráfego IA** (`server/copilot.js`): Claude com uma cartilha de tráfego para restaurantes. Ele lê os números e **propõe** pausas, orçamentos e campanhas; nada é aplicado sem o toque em "Confirmar".
- **Modo exemplo**: plataforma sem credenciais usa dados de exemplo. Dá para testar tudo sem conta conectada.
- **Auditoria**: toda alteração fica registrada com quem fez, de onde (tela ou gestor IA) e o resultado.

## Rodar no computador

Precisa de Node.js 20 ou mais novo.

```bash
npm install
cp .env.example .env   # preencha a senha e as chaves que já tiver
node --env-file=.env server/index.js
```

Abra http://localhost:3000.

## Publicar na internet

Qualquer serviço que rode Node ou Docker serve (Render, Railway, Fly.io, uma VPS). Use o `Dockerfile`, monte um volume em `/data` para não perder as lojas e o histórico, e configure as variáveis do `.env.example` no painel do serviço. Use sempre HTTPS e uma `APP_PASSWORD` forte.

## Conectar as plataformas

Passo a passo em [`docs/requisitos-apis.md`](docs/requisitos-apis.md). Resumo:

| Plataforma | O que precisa | Variáveis |
|---|---|---|
| Meta | Business Manager verificado, app com Marketing API e acesso avançado a `ads_management`, token de Usuário do Sistema | `META_ACCESS_TOKEN` |
| Google Ads | Conta de administrador (MCC), developer token com Basic Access, cliente OAuth do Google Cloud e refresh token | `GOOGLE_ADS_*` |
| Gestor IA | Chave da Claude API | `ANTHROPIC_API_KEY` |

Depois, em **Lojas e contas**, cadastre em cada loja o ID da conta de anúncio Meta (`act_...`) e o ID de cliente Google Ads (`123-456-7890`).

## Limites desta versão

- Meta: criar campanha cria só a campanha, **pausada**. Público e criativo ainda são adicionados no Gerenciador de Anúncios antes de ativar.
- Google Ads: pausar, reativar e mudar orçamento funcionam; criar campanha ainda é feito no Google Ads.
- Receita: quando a plataforma não mede vendas, o app estima com pedidos × ticket médio da loja e avisa.
- As conexões reais com Meta e Google ainda não foram testadas contra contas de verdade; teste primeiro com uma conta de teste de cada plataforma.
- Um usuário com senha única. Para equipe com logins separados, o próximo passo é trocar `data/db.json` por um banco de dados e adicionar usuários.
