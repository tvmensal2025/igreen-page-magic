## Plano — 4 frentes

### 1) Nome da IA (assistant_name) — parar de aparecer "Camila"

O onboarding e a aba Dados já salvam `consultants.assistant_name`, mas alguns pontos ainda gravam/usam "Camila" como fallback. Trocar para usar sempre o nome do consultor.

**Backend (edge functions):**

- `supabase/functions/_shared/notify-consultant.ts` (linha 240): mensagem "🤖 A IA Camila já iniciou…" — buscar `assistant_name` do consultor e interpolar.
- `supabase/functions/_shared/fluxo-b-ia/agent.ts` (linha 337): no histórico passado pro LLM, trocar `"Camila"` fixo por `assistantName` já resolvido na linha 78.
- `supabase/functions/ai-agent-router/index.ts` (linha 191): manter `assistant_name` mas trocar fallback `"Camila"` por `"Assistente"` (só usado se o consultor não definiu nada).
- `supabase/functions/_shared/fluxo-b-ia/agent.ts` (linha 78): mesmo fallback → `"Assistente"`.

**Frontend (aba Dados):**

- `src/components/admin/DadosTab.tsx`: trocar default state `"Camila"` por string vazia e placeholder `"Como sua IA se chama?"`; salvar exatamente o que o usuário digitou (nunca sobrescrever para Camila).

**Comentários e textos visuais com "Camila"** (página interna, não enviada ao lead): manter — referem-se ao nome do fluxo histórico, não à identidade da IA do consultor.

### 2) Frase IA do parceiro — preencher direto e salvar

Hoje (`PartnerForm.tsx`, função `generateExample`) a IA mostra o texto num card de preview separado e o usuário precisa copiar manualmente para a frase.

Mudar para:

- Quando a IA responder, **jogar o texto direto no campo "Frase QR Code"** (`qrPhrase`), deixando-o editável.
- Se for edição de parceiro existente, disparar `onSave` automaticamente após gerar (auto-save).
- Se for criação de novo parceiro, apenas preencher o campo (precisa de nome/CLI pra salvar) e mostrar um toast "Frase gerada — revise e clique Criar".
- Remover o card "Exemplo IA" duplicado; manter botão de regerar ao lado do campo.

### 3) Proposta lenta no celular do cliente

`src/pages/ProposalPublicPage.tsx` (550 linhas) hoje:

- Carrega `useProducts()` (catálogo inteiro) antes de mostrar a proposta.
- Importa `ProductLandingSections` no bundle inicial (landing pesada de fundo).
- Modal abre só depois do `getPublicProposal` + catálogo resolver.

Otimizações:

- **Renderizar a proposta assim que `getPublicProposal` retornar** (não esperar `useProducts`).
- **Lazy-load** de `ProductLandingSections` + `ProductCatalog` via `React.lazy` + `Suspense` (a landing de fundo só importa quando o modal fecha).
- Adicionar `<SEOHead>` com `<link rel="preconnect">` para o domínio do Supabase + skeleton imediato (sem `<LoadingScreen/>` cheio que bloqueia).
- Marcar imagens da landing com `loading="lazy"` e `fetchpriority="low"`; logo/avatar do consultor com `fetchpriority="high"`.
- No `getPublicProposal` (edge), devolver só o essencial primeiro; mover dados de landing pra segunda chamada (se ainda não estiver assim — confirmar no `publicApi.ts`).

Meta: First Contentful Paint do modal < 1.5s em 4G.

### 4) Página do vendedor de Produtos — auditoria + simplificação

**Auditoria de bugs** em `src/features/produtos/`:

- `OrcamentoBuilderSheet.tsx` (sheet de gerar orçamento): revisar erros silenciosos no `useCreateProposal`, validação de centavos, envio WhatsApp.
- `ProposalsPanel.tsx`: revisar filtros, status, refresh após criar.
- `AcompanhamentoPanel.tsx`: confirmar contagens vs realidade no DB.
- `RecipientPicker.tsx`: dedup de leads e busca rápida.

&nbsp;

### Ordem de execução

1. Itens 1 e 2 (rápidos, baixo risco).
2. Item 3 (proposta mobile) — fazer lazy-load + medir.
3. Item 4 (auditoria 

### Detalhes técnicos

- Sem migration nova: `assistant_name` e `consultants` já existem.
- Edge functions afetadas serão redeployadas automaticamente.
- Sem mudança de RLS.
- Testes: rodar `vitest` nos `__tests__` de `produtos/` após mudanças no builder.