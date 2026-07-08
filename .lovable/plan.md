
# Tutorial completo da plataforma — `/tutorial`

Objetivo: uma página **pública** (sem login), única e longa, com **índice lateral fixo**, screenshots reais de cada tela e explicações simples ("para leigos") de **cada botão, cada ícone, cada aba**. Bonita, profissional, fácil de dar Ctrl+F.

---

## 1. Rota e acesso

- Nova rota pública em `src/App.tsx`: `/tutorial` → novo `src/pages/Tutorial.tsx`.
- **Sem** `ProtectedRoute` (qualquer pessoa com o link entra).
- Link discreto no rodapé da landing e um item "Ajuda / Tutorial" no menu do Admin (`AppSidebar`) e no `AppTopbar` (ícone `HelpCircle`), abrindo `/tutorial` em nova aba.
- SEO: `<SEOHead>` com título "Tutorial completo — iGreen Cloud", descrição e H1 únicos.

## 2. Estrutura visual da página

Layout desktop de 2 colunas, mobile empilhado:

```text
┌───────────────────────────────────────────────────────────────┐
│  Header: logo + título + campo de busca (filtra seções)       │
├──────────────┬────────────────────────────────────────────────┤
│              │  Seção 1 — Visão geral                         │
│  Índice      │    texto + ilustração                          │
│  lateral     │                                                │
│  (sticky,    │  Seção 2 — Site público                        │
│  scrollspy)  │    subseções, screenshots, callouts            │
│              │                                                │
│              │  Seção 3 — Área do consultor                   │
│              │  ...                                           │
└──────────────┴────────────────────────────────────────────────┘
```

Componentes reutilizáveis (dentro de `src/components/tutorial/`):

- `TutorialLayout.tsx` — casca com sidebar sticky + área de conteúdo + busca client-side que filtra headings.
- `TutorialSection.tsx` — bloco com `id`, título, subtítulo, badge de área (Público / Consultor / Admin / Super Admin).
- `TutorialStep.tsx` — passo numerado com título, texto e print opcional.
- `TutorialCallout.tsx` — caixas coloridas: "Dica", "Atenção", "Para leigos", "Quando usar".
- `TutorialScreenshot.tsx` — imagem com legenda, zoom no clique (dialog do shadcn) e setas/pins opcionais destacando botões.
- `TutorialToc.tsx` — índice com scrollspy (destaca a seção visível).
- `TutorialSearch.tsx` — input que filtra seções por título/texto.

Estilo: usa tokens já existentes do design system (sem cor hardcoded). Tipografia grande, muito espaço em branco, ícones `lucide-react` em cada seção.

## 3. Screenshots reais — como serão produzidos

Playwright roda no sandbox contra `http://localhost:8080`, usando a sessão Supabase gerenciada (`LOVABLE_BROWSER_AUTH_STATUS=injected`) para capturar as telas autenticadas. Cada print é salvo em `src/assets/tutorial/` e importado no `Tutorial.tsx`.

Rotas fotografadas (uma imagem principal por tela, mais crops de botões-chave):

**Público**
1. `/auth` — login/cadastro
2. `/` landing consultor `/:licenca` (hero, seções, WhatsApp float)
3. `/licenciado/:licenca` e `/licenciado/preview`
4. `/cadastro/:licenca`
5. `/crm` (CRM landing)
6. `/assistente`
7. `/conexao-telecom|seguros|solar|placas|livre|club|club-pj|green|expansao/:licenca` (1 print representativo + lista dos 9 produtos)
8. `/proposta/:token`
9. `/install`, `/politica-privacidade`, `/reset`

**Admin (`/admin`)** — cada aba do `Admin.tsx`:
- Dashboard, Dados, Links, Materiais, Preview, Rede, Ranking do time, AI Agent, Notificações, Sync geral (novo `SyncAllPanel`), Onboarding.
- Barra superior (`AppTopbar`): sidebar toggle, **Olho (privacidade)**, **Estrela (IA — `AIChatPanel`)**, **Sino (`NotificationCenter`)**, atalhos, avatar.
- Sidebar (`AppSidebar`): cada item de menu.

**Admin — subpáginas**
- `/admin/whatsapp-clients` (todas as abas: iGreen, conversas, etc.)
- `/admin/fluxos` (`FluxoBuilder`) — canvas, paleta de nós, painel de propriedades, testar/publicar.
- `/admin/fluxo-b`, `/admin/saude-bot`, `/admin/saude-producao`, `/admin/portal-monitor`
- `/admin/conhecimento` (FAQ + IA), `/admin/reaquecimento`, `/admin/recon`, `/admin/conversao`, `/admin/meta-ads`, `/admin/solar-design`.

**Super Admin (`/super-admin`)** — cada painel: `AIControlPanel`, `AIAuditPanel`, `AIKnowledgePanel`, `BotGlobalKillSwitch`, `BotFunnelPanel`, `AdManagersTab`, `AdTemplatesPanel`, `ABResultsPanel`, `CaptacaoTab`, `CrmAnalyticsTab`, `FaqComparativoPanel`, `FlowTemplateApprovalPanel`, `InfraHealthPanel`, `LearnedPatternsPanel`, `PhoneResetButton`, `ResolverStrictModeToggle`, `RolloutPanel`, `SolarModulePanel`, `StuckLeadsWidget`, `SystemHealthPanel`, `WhatsAppInstanceHealthCard`, `WorkerPhaseTimeline`, `DevToolsBlockToggle`, `AuditLogPanel`, `/super-admin/suporte`.

Se alguma rota exigir dados que não existem em dev, uso um placeholder gerado pelo `imagegen` com legenda "exemplo ilustrativo".

## 4. Conteúdo — o que cada seção explica (para leigos)

Para **cada** tela/botão/ícone, o mesmo padrão em 4 blocos:

1. **O que é** — em uma frase, sem jargão.
2. **Para que serve / por que usar** — benefício prático.
3. **Como usar (passo a passo)** — 1, 2, 3… com print destacando o botão.
4. **Cuidados / dicas** — quando NÃO usar, atalhos, o que pode dar errado.

### Sumário do conteúdo (índice lateral)

1. Boas-vindas e como usar este tutorial
2. Glossário rápido (Consultor, Licenciado, Lead, Fluxo, Bot, CRM, Cron, etc.)
3. **Site público**
   - 3.1 Página inicial da consultora `/:licenca`
   - 3.2 Página do licenciado
   - 3.3 Cadastro de cliente
   - 3.4 Páginas de produto Conexão (Telecom, Seguros, Solar, Placas, Livre, Club, Club PJ, Green, Expansão)
   - 3.5 Proposta pública
   - 3.6 CRM landing / Assistente / Instalar app
4. **Login e primeiro acesso** (`/auth`, recuperar senha, PWA)
5. **Barra do topo do Admin (o que faz cada ícone)**
   - 5.1 Botão de recolher a barra lateral
   - 5.2 **Olho (modo privacidade)** — esconde números sensíveis em apresentações
   - 5.3 **Estrela (IA)** — abre o assistente de IA (`AIChatPanel`): perguntar sobre a plataforma, gerar textos, resumir conversas
   - 5.4 **Sino (Notificações)** — `NotificationCenter`: ler, marcar como lida, apagar
   - 5.5 Avatar / trocar conta / sair
6. **Menu lateral do Admin** — item a item
7. **Admin › Dashboard** (cada card e gráfico)
8. **Admin › Dados** — perfil, links, IGreen, foto, **botão Sincronizar agora** (novo `SyncAllPanel` — o que dispara e quando usar)
9. **Admin › Links / QR / Panfleto**
10. **Admin › Materiais**
11. **Admin › Preview da página pública**
12. **Admin › Rede / Ranking do time**
13. **Admin › AI Agent** (quando ligar, custo, limites)
14. **Admin › Clientes WhatsApp** (`/admin/whatsapp-clients`, cada aba, ações em massa, envio de áudio, marcar como cliente iGreen)
15. **Admin › Fluxos** (`FluxoBuilder`) — cada tipo de nó, como testar, publicar, versionar
16. **Admin › Fluxo B / A-B test**
17. **Admin › Saúde do Bot / Produção / Portal Monitor**
18. **Admin › Conhecimento (FAQ + IA)**
19. **Admin › Reaquecimento** (público-alvo, cadência, kill switch)
20. **Admin › Reconciliação iGreen**
21. **Admin › Conversão**
22. **Admin › Meta Ads** (contas, criativos, comparativos)
23. **Admin › Solar Design**
24. **Super Admin — visão geral e responsabilidade**
25. Super Admin — painéis um a um (IA control/audit/knowledge, kill switch, funil, ads managers, templates, A/B, captação, CRM analytics, FAQ comparativo, aprovação de fluxos, saúde de infra, padrões aprendidos, reset de telefone, resolver strict, rollout, módulo solar, leads travados, saúde do sistema, saúde de instância WhatsApp, timeline do worker, bloqueio de DevTools, log de auditoria, suporte remoto)
26. **Sincronizações manuais** — o que cada botão do `SyncAllPanel` executa e com que frequência rodar
27. **Erros comuns e como resolver** (login CORS/504, WhatsApp desconectado, fluxo não dispara, sincronização travada, notificações não chegam)
28. **Segurança e boas práticas** (senhas, quem pode ser admin, modo privacidade em reuniões)
29. **FAQ** (perguntas curtas)
30. **Contato / suporte**

Cada seção 5.x, 7–25 lista os botões visíveis no print e explica cada um.

## 5. Fluxo de trabalho do build

1. Criar rota e casca (`Tutorial.tsx`, layout, TOC, busca) com conteúdo placeholder — commit visualmente funcional.
2. Rodar Playwright em batelada para capturar todas as rotas listadas em §3, salvar em `src/assets/tutorial/`.
3. Preencher o conteúdo de cada seção seguindo o padrão dos 4 blocos, importando os prints.
4. Adicionar link para `/tutorial` no `AppSidebar`, `AppTopbar` e rodapé da landing.
5. Verificar: build, rota abre deslogado, TOC com scrollspy, busca filtra, imagens carregam, responsivo mobile.

## 6. Detalhes técnicos

- Framework atual (React + Vite + Tailwind + shadcn) — sem novas dependências além de possivelmente `react-intersection-observer` para o scrollspy (ou implementação manual com `IntersectionObserver` nativo, preferida).
- Imagens: JPG otimizado (`<img loading="lazy" />`), largura máxima ~1280px.
- Acessibilidade: headings semânticos `h1`/`h2`/`h3`, `alt` descritivo em cada print, foco visível, contraste via tokens.
- SEO: `<title>`, `meta description`, `og:*`, `twitter:card`, JSON-LD `Article`.
- Nenhuma alteração em edge functions, banco, RLS, cron ou lógica de negócio. Puramente frontend.

## 7. Fora do escopo (para não inflar)

- Vídeos/GIFs animados (só screenshots estáticos nesta versão — podemos adicionar depois).
- Tour interativo dentro das telas reais (foi descartado na pergunta anterior).
- Tradução para outros idiomas.

## 8. Resultado esperado

Uma página `/tutorial` pública, longa, bonita e navegável, que documenta **cada** rota, aba, botão e ícone da plataforma (incluindo os três do topo: sino, IA, olho), com prints reais e linguagem para leigos. Qualquer pessoa que abrir o link consegue entender e operar a plataforma sem ajuda.
