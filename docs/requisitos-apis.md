# Requisitos para ligar o app às contas reais de anúncio

Levantamento de outubro de 2026, feito a partir do conhecimento das APIs oficiais. Conferir as páginas de cada plataforma no momento de solicitar, porque os níveis de acesso mudam com frequência.

## Meta (Facebook + Instagram) — Marketing API

1. **Business Manager (Meta Business Suite) da consultoria**, com verificação da empresa concluída (CNPJ, documento, domínio).
2. **App em developers.facebook.com** do tipo "Business", com o produto Marketing API adicionado.
3. **Permissões**: `ads_management`, `ads_read`, `business_management`, `pages_read_engagement` (para criativos de página) e `instagram_basic` se for publicar no IG.
4. **Acesso avançado (App Review)**: para gerenciar contas de anúncio de clientes (que não são suas), as permissões acima precisam de Advanced Access, aprovado pela Meta com vídeo de demonstração do app.
5. **Token de Usuário do Sistema** gerado no Business Manager. É o jeito certo para agência: não expira como o token pessoal e é atribuído a cada conta de anúncio de cliente.
6. **Acesso às contas dos clientes**: cada restaurante compartilha a conta de anúncio com o Business Manager da consultoria (como parceiro).
7. **Limites**: o app começa no nível "Development" (poucas chamadas). O nível "Standard" libera volume após uso consistente e sem erros.

## Google Ads — Google Ads API

1. **Conta de administrador (MCC)** da consultoria, com as contas dos restaurantes vinculadas a ela.
2. **Developer token** solicitado na Central de API da MCC. Ele nasce com "Test Account Access" (só contas de teste).
3. **Basic Access**: formulário com descrição do app (design doc). Libera contas reais com cota diária de operações suficiente para uma agência.
4. **Projeto no Google Cloud** com a Google Ads API ativada e cliente OAuth 2.0. O escopo `adwords` é sensível, então a tela de consentimento OAuth precisa de verificação do Google se o app for usado por pessoas de fora da consultoria.
5. **Cabeçalho `login-customer-id`** com o ID da MCC em cada chamada, para operar as contas filhas.

## Arquitetura recomendada

- **Servidor próprio (backend)** guardando os tokens. Nada de token no celular ou no navegador.
- **Copiloto Claude** via Claude API com ferramentas (tool use): listar campanhas, pausar, alterar orçamento, criar campanha, gerar relatório. Ações que gastam dinheiro sempre voltam como proposta para o usuário confirmar.
- **Voz**: transcrição no app (reconhecimento de fala do celular ou um serviço de transcrição) e resposta falada por síntese de voz em pt-BR.
- **App instalável (PWA)** para usar no celular sem loja; app nativo só se precisar depois.
- **Registro de auditoria**: toda alteração feita (por pessoa ou pelo copiloto) fica salva com data, autor e valor anterior.

## Próximos passos para sair do protótipo

1. Abrir/verificar o Business Manager e criar o app Meta.
2. Criar a MCC (se ainda não existir) e pedir o developer token.
3. Escolher onde hospedar o backend e criar o repositório.
4. Ligar uma conta de teste de cada plataforma antes de qualquer conta real.
