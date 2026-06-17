## Resumo dos problemas
1. Modal de ID (pós-liberação) fecha sozinho — precisa travar até salvar.
2. Campo de ID não deve mais aparecer no cadastro inicial do cliente.
3. Forçar atualização para todos os usuários (cache trava versões antigas).
4. Link do QR Code de parceiro deve abrir tanto WhatsApp normal quanto Business.
5. Algumas propostas não têm botão X para excluir — padronizar exclusão em todas.
6. Lentidão geral (envio msg, fluxo, recebimento, UI) — auditoria + otimizações.
7. Dashboard com pódio Top 3 (estilo palco) por nº de indicações.

---

## 1. Modal de ID — travar fechamento + remover do cadastro

**Arquivos a investigar/editar:**
- `src/components/admin/parceiros/` e `src/features/produtos/vendas/orcamento/captura/` (referências hardcoded encontradas em análise anterior).
- Localizar o `Dialog` que pede ID pós-liberação.

**Mudanças:**
- `Dialog`: adicionar `onPointerDownOutside={(e) => e.preventDefault()}` e `onEscapeKeyDown={(e) => e.preventDefault()}`, esconder o botão "X" do `DialogContent` enquanto o campo ID estiver vazio/inválido.
- Botão "Salvar" só habilita quando ID preenchido e validado.
- Cadastro inicial: remover o input de ID (e seu schema de validação) — o ID passa a ser pedido somente nesse modal pós-liberação.

## 2. Forçar atualização (auto-reload silencioso)

**Estratégia:**
- Em `public/sw.js`: incrementar `CACHE_VERSION`, e no `activate` chamar `clients.claim()` + `caches.delete(old)`.
- No `main.tsx`: ao registrar SW, escutar `controllerchange` → `window.location.reload()` silencioso.
- Adicionar `<meta name="build-id">` no `index.html` lido por um pequeno `useEffect` que faz polling a cada 5 min em `/version.json` (gerado no build). Se mudou → `caches.delete()` + reload.
- Sem toast (silencioso, conforme escolha).

## 3. Link do parceiro abre WhatsApp + WhatsApp Business

**Arquivo:** `src/pages/PartnerRedirectPage.tsx` e geração do link em `useReferralPartners.ts`.

**Estratégia:**
- Hoje o link usa `https://wa.me/...` que abre só o app padrão.
- Mudar para uma página intermediária que mostra 2 botões grandes: "Abrir no WhatsApp" e "Abrir no WhatsApp Business", usando os schemes:
  - WhatsApp: `whatsapp://send?phone=...&text=...`
  - Business: `whatsapp-business://send?phone=...&text=...` (Android) ou fallback `wa.me`.
- Mobile detection: se único app instalado, redireciona direto; senão mostra escolha.

## 4. Excluir propostas — botão X em todas

**Arquivos:** `src/features/produtos/orcamento/`, `ProposalsPanel.tsx`, `AcompanhamentoPanel.tsx`, listagens em outras abas.

**Estratégia:**
- Auditar todos os cards/linhas de proposta e garantir que cada um tenha o botão X com `AlertDialog` de confirmação.
- Centralizar em um componente `ProposalDeleteButton` reutilizável (chama `deleteProposal(id)` + invalida queries).
- Garantir RLS já permite delete (verificar policy de `proposals`).

## 5. Performance — auditoria geral

**Diagnóstico (em ordem):**
1. Rodar `supabase--slow_queries` para identificar queries pesadas.
2. Rodar `browser--performance_profile` na rota `/admin` para Web Vitals e long tasks.
3. Listar bundle splits em `vite.config.ts` e checar tamanhos.

**Otimizações previstas:**
- **Webhook recebimento**: revisar `supabase/functions/_shared/fluxo-b-ia/` — async/await sequenciais que poderiam ser paralelos; remover writes desnecessários a `customer_processing_lock`.
- **Envio msg**: revisar `src/lib/whatsapp/send.ts` e `templateSender.ts` — eliminar re-fetches; usar `Promise.all`.
- **UI**: adicionar `React.memo` em listas grandes (Kanban, ProposalsPanel), trocar `useEffect` que rebuscam tudo por subscriptions já existentes, lazy-load de rotas pesadas em `App.tsx`.
- **Queries**: adicionar índices nos campos mais filtrados (a definir após slow_queries).
- **React Query**: aumentar `staleTime` global para 30s, evitar refetch on focus em listas estáticas.

## 6. Dashboard — Pódio Top 3 (palco) por nº de indicações

**Arquivo:** `src/components/admin/parceiros/PartnerDashboard.tsx` (ou dashboard principal admin — confirmar onde encaixar).

**Estratégia:**
- Novo componente `ReferralPodium.tsx`: 3 colunas com alturas diferentes (2º à esquerda média, 1º central alta, 3º direita baixa), avatar + nome + nº indicações + medalha emoji 🥇🥈🥉.
- Animação de entrada (`framer-motion` ou CSS keyframes).
- Query: `select consultant_id, count(*) from network_members group by consultant_id order by count desc limit 3` (ajustar tabela conforme schema real de "indicações").

---

## Ordem de execução proposta
1. Modal ID + remoção do cadastro (rápido, alto impacto UX).
2. Botão excluir em todas as propostas (rápido).
3. Service Worker + auto-reload silencioso (deploy garante todos atualizarem).
4. Página intermediária WhatsApp normal/Business.
5. Pódio Top 3 no dashboard.
6. Auditoria de performance (diagnóstico → otimizações pontuais).

Confirma essa ordem? Posso começar.