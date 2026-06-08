## Objetivo

Garantir que **FAQ (atalhos) e Base da IA** apareçam para todos os consultores (obrigatoriamente públicos), e dar ao **Super Admin** controle uniforme nos cards de cada item (templates de mensagem, áudios, vídeos, imagens, templates de anúncio, FAQ, knowledge) com:

- Menu de **3 pontinhos** → alternar **🌎 Público / 🔒 Privado**
- Botão **X** → apagar com **diálogo de confirmação**

## Estado atual (auditoria rápida)

| Tipo | Tabela | Como "público" funciona hoje |
|---|---|---|
| Templates de mensagem | `message_templates` | `is_public boolean` — 22 linhas, todas `false` |
| Áudios | `audio_library` | `is_public` (toggle já existe no AudioStudio) |
| Mídia IA (imagem/vídeo) | `ai_media_library` | `is_public` (sem toggle UI) |
| Templates de voz | `voice_templates` | `is_public` (sem toggle UI) |
| Anúncios | `ad_templates` | `consultant_id IS NULL` + `status='published'` |
| **FAQ atalhos** | `bot_flow_qa` | ❌ ligado a `flow_id` de um consultor → nunca aparece pro outro |
| **Knowledge IA** | `ai_knowledge_sections` | 27 linhas com `consultant_id NULL` → já são globais, mas leitura pelo consultor pode estar bloqueada |

**Diagnóstico do que o cliente reportou:** Os atalhos da Bruna e do Rafael não aparecem como "público" porque `bot_flow_qa` não tem coluna pública — cada consultor só lê o próprio fluxo. E `ai_knowledge_sections` precisa de RLS de leitura para todos os autenticados.

## Mudanças

### 1. Banco (migration única)

- `ALTER TABLE bot_flow_qa ADD COLUMN is_public boolean NOT NULL DEFAULT false`
- RLS: SELECT em `bot_flow_qa` para `authenticated` quando `is_public = true` (mantém leitura do próprio fluxo)
- RLS: SELECT em `ai_knowledge_sections` para `authenticated` quando `consultant_id IS NULL OR consultant_id = auth.uid()` (e UPDATE/DELETE só para Super Admin nos globais)
- Backfill: marcar como `is_public=true` os QAs de fluxos do Super Admin (rafael.ids@icloud.com) — eles viram a base pública

### 2. Componente novo `SuperAdminItemMenu`

Um único componente reutilizável (DropdownMenu shadcn) usado em todos os cards:

```
[⋯]  → 🌎 Tornar público / 🔒 Tornar privado
       ─────────
       🗑 Apagar (vermelho)

[X]  → AlertDialog "Apagar '{nome}'? Esta ação é irreversível."
```

Aparece **apenas** quando `isSuperAdmin === true`. Recebe props `{ isPublic, onTogglePublic, onDelete, itemName, itemKind }`.

### 3. Pontos de integração na UI

| Arquivo | Mudança |
|---|---|
| `TemplateListItem` (msg templates) | Adiciona `<SuperAdminItemMenu>` com toggle `is_public` e delete |
| `AudioStudio.tsx` | Substitui os botões soltos por `<SuperAdminItemMenu>` (já tem toggle, falta delete confirmado e padronização) |
| `AIMediaPicker` / `MediaLibraryPicker` | Adiciona menu nos cards de imagem/vídeo |
| `TemplateInfoCard` (ads) | Já tem ações; padroniza com X de confirmação |
| `FaqSection.tsx` | Cada FAQ ganha menu (toggle is_public) e X; lista também os FAQs públicos de outros consultores em aba "Globais" |
| `AdminFaq.tsx` / `EmbeddingsControl` | Knowledge sections ganham toggle público/privado e X |
| `voice templates` (se houver UI) | Mesmo menu |

### 4. Confirmação de exclusão

Usar o `useConfirm()` já existente em `src/components/ui/confirm-dialog.tsx` com `tone: "danger"`. Mensagem padrão:

> Apagar **{nome do item}**?
> Esta ação é irreversível.

## Detalhes técnicos

- `useUserRole(authUserId).isSuperAdmin` controla a renderização do menu
- Toggle público faz `UPDATE ... SET is_public = NOT is_public` + toast "🌎 Publicado" / "🔒 Despublicado"
- Para `ad_templates` (que usa `status`), o toggle alterna `published ↔ archived`
- Para `bot_flow_qa`, toggle só faz sentido em FAQs de fluxos do Super Admin (mostra mensagem de aviso em outros casos)
- Realtime/refetch após cada ação para refletir na UI

## Fora de escopo

- Não mexer no fluxo de suporte remoto desta vez
- Não criar novas tabelas (só adicionar coluna em `bot_flow_qa`)
- Não alterar lógica de fork de templates (já funciona)

## Arquivos tocados

- `supabase/migrations/<novo>.sql`
- `src/components/admin/SuperAdminItemMenu.tsx` (novo)
- `src/components/whatsapp/TemplateListItem.tsx`
- `src/components/admin/AudioStudio.tsx`
- `src/components/admin/ads/TemplateInfoCard.tsx`
- `src/components/admin/fluxo/FaqSection.tsx`
- `src/pages/AdminFaq.tsx`
- `src/components/admin/AIAgentTab/MediaColumn.tsx` (se for o picker de mídia)
