## Objetivo

Novo consultor admin entra e o próprio sistema o ensina a usar tudo — sem manual em PDF, sem vídeo obrigatório. Trilha única, spotlight em botões reais, conteúdo gerado por IA a partir do código e editável depois.

## Como vai funcionar (visão do consultor)

1. **1º login** → tela cheia com "Bem-vindo. Faz um tour de 5 min pra você usar 100% da plataforma?" com botões **Começar** / **Depois**.
2. Balões destacam bot�es reais em cada tela ("Aqui você conecta o WhatsApp", "Este é o Kanban do CRM"), com **Próximo / Voltar / Pular etapa / Fechar**.
3. Progresso salva sozinho. Se sair no meio, ao voltar → "Continuar de onde parou?".
4. Bot�o flutuante **"?"** no canto inferior direito, **sempre visível**, abre menu:
   - Reiniciar tour completo
   - Central de Ajuda
   - Falar com suporte (abre o chat de suporte que já existe)
5. Em cada tela importante, um **"?" pequeno inline** ao lado do título → abre balão contextual só daquela tela ("Como funciona o Motor de Cadência").

## A trilha (12 passos)

Ordem pensada pra ir do essencial ao avançado:

1. **Boas-vindas** — o que a plataforma faz em 3 frases (captar → conversar → fechar → pós-venda).
2. **Menu lateral** — mapa geral do `/admin`.
3. **WhatsApp — conectar instância** — sem isso nada funciona (destaca botão QR).
4. **WhatsApp — ligar o robô** — kill switch global + toggle por consultor.
5. **CRM (Kanban)** — como mover cards, o que cada coluna faz.
6. **Captação de leads** — lista + seleção múltipla + "Iniciar atendimento em lote".
7. **Conversão** — leads parados dos últimos 120 dias, como retomar.
8. **Motor de Cadência** — o robô nunca deixa lead esfriar (WA → ligação → SMS).
9. **Meta Ads + Carteira** — criar campanha, saldo mínimo, protocolo automático.
10. **Hub de textos** (`/admin/agendamentos-central`) — **tudo** que o robô fala é editável aqui (as 15 abas que acabamos de montar).
11. **Central de Automações** — ligar/desligar cada função com um clique.
12. **Onde pedir ajuda** — mostra o botão "?" que ficou fixo e explica como reabrir o tour.

## Conteúdo gerado por IA + editável

- Edge function **`generate-tour-content`** roda 1× e lê:
  - `docs/auditoria/05-fluxos-do-sistema.md`
  - `docs/captacao/MAPA-OPERACIONAL.md`
  - `docs/captacao/DECISOES-PRODUTO-BOT.md`
  - `src/features/produtos/acompanhamento/sistemaCapacidadesMapa.ts`
  - `src/lib/agendamentosTextosCatalog.ts`
- Modelo: `google/gemini-2.5-flash` via Lovable AI Gateway.
- Gera JSON com título curto (máx 40 chars), texto (máx 200 chars) e call-to-action de cada passo.
- Você edita tudo em **`/admin/ajuda/editor`** — 12 cards, campo título, campo texto, campo "link saiba mais", botão **Salvar** por passo. Sem mexer no código.
- Bot�o **"Regenerar rascunho com IA"** por passo se quiser tentar outro texto.

## Central de Ajuda (`/ajuda`)

Complemento leve pra quando o consultor quer consultar depois:
- Busca por palavra-chave.
- Categorias: WhatsApp · Campanhas · CRM · Cadência · Pós-venda · Textos e IA · Financeiro.
- Cada artigo tem botão **"Fazer o tour desta função"** → dispara o driver.js já na tela certa.
- Consultor pode adicionar seus próprios artigos (mesma tabela, botão "Novo artigo" pra admin).

## Persistência (3 tabelas novas)

| Tabela | Campos principais | Uso |
|---|---|---|
| `tour_steps` | `order_index`, `route`, `selector`, `title`, `body`, `cta_label`, `cta_href` | Os 12 passos da trilha, editáveis |
| `tour_articles` | `category`, `title`, `body`, `video_url`, `related_tour_step_id` | Central de Ajuda |
| `user_tour_progress` | `user_id`, `current_step`, `completed_at`, `dismissed_at` | Retomar de onde parou, saber quem já fez |

RLS:
- `tour_steps` e `tour_articles`: qualquer `authenticated` lê; só quem tem `has_role('admin')` edita.
- `user_tour_progress`: cada usuário só vê/edita a própria linha (`auth.uid() = user_id`).

Grants completos (`anon`, `authenticated`, `service_role`) na mesma migration.

## Arquivos a criar

- `src/features/onboarding/TourProvider.tsx` — driver.js + botão "?" flutuante, envolve o `AppLayout`.
- `src/features/onboarding/useTour.ts` — dispara/retoma/pula trilha, marca progresso.
- `src/features/onboarding/tourSteps.ts` — carrega os passos do banco + fallback estático.
- `src/features/onboarding/InlineHelpButton.tsx` — o "?" pequeno de cada tela.
- `src/pages/AjudaPage.tsx` — Central de Ajuda com busca e categorias.
- `src/pages/AdminTourEditor.tsx` — editor dos 12 passos + regenerar com IA.
- `supabase/functions/generate-tour-content/index.ts` — chama Lovable AI Gateway.
- Migration com as 3 tabelas + RLS + grants + seed dos 12 passos vazios.
- Adicionar `data-tour="wa-connect"`, `data-tour="kanban"`, etc. nos ~12 botões-alvo (seletores estáveis).

## Fora do escopo

- Trilha de parceiro (você pediu pra deixar de fora).
- Vídeos (campo `video_url` fica no schema, mas não gravamos nada agora).
- Tradução — só português.

## Ordem de execução

1. Migration (3 tabelas + RLS + grants + seed).
2. Edge function `generate-tour-content` + rodar 1× pra popular o rascunho.
3. `TourProvider` + botão "?" flutuante no `AppLayout`.
4. `data-tour="…"` nos 12 botões-alvo.
5. `/admin/ajuda/editor` pra você revisar e ajustar os textos.
6. `/ajuda` (Central de Ajuda) + `InlineHelpButton` nas telas principais.
7. Testar o fluxo completo com um usuário novo (sem `user_tour_progress`) e ajustar.

Ao terminar cada etapa te mostro o que ficou pra você aprovar antes de seguir.
