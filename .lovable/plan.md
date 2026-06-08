## 1. Botão "Invalidar" no popup de confirmação pendente

**Problema:** Alguns clientes vêm marcados como "Validado" mas não foram. Sempre aparecem no popup.

**Mudanças em `src/components/whatsapp/PendingApprovalDialog.tsx`:**
- Adicionar 4º botão `Invalidar` (ícone XCircle, variante destructive-ghost) em cada linha.
- Ao clicar → confirmação ("Marcar como inválido e remover da fila?") → chama nova ação `invalidate` na RPC `confirm_pending_classification`.
- Cliente recebe `pos_venda_pending_stage = NULL`, `pos_venda_invalid = true`, sai do popup permanentemente.

**Migration:** adicionar coluna `pos_venda_invalid boolean default false` em `customers` e estender a RPC `confirm_pending_classification` para aceitar `_action = 'invalidate'`.

## 2. Visual do popup melhorado

**Problema:** Layout pesado, "sem_celular_1431733" fica feio ao lado do nome, badges desalinhados.

**Mudanças em `PendingApprovalDialog.tsx`:**
- Esconder telefone quando começar com `sem_celular_` — mostrar badge cinza "Sem WhatsApp" no lugar.
- Avatar circular com inicial do nome (cor por hash) à esquerda.
- Nome em negrito + linha secundária com telefone formatado (+55 11 99999-9999) OU badge "Sem WhatsApp".
- Botões compactos: `Confirmar` (primary), `Rever` (outline), `Invalidar` (ghost vermelho), `Adiar` (ícone só).
- Hover sutil, divisórias mais leves, padding reduzido, contagem por seção com chip colorido.
- Header sticky com busca rápida quando >20 itens.

## 3. Passos do fluxo com nomes amigáveis

**Problema:** Steps aparecem com IDs como `passo_mp8yc0bp` no admin de templates.

**Mudanças em `src/components/whatsapp/templates/TemplateListItem.tsx` e onde lista steps:**
- Criar helper `prettyStepLabel(stepId, stepTitle)` que:
  - Usa `title` se existir.
  - Mapeia slugs conhecidos (`boas_vindas` → "Boas-vindas", `fazenda_solar` → "Fazenda Solar", etc.).
  - Para IDs gerados (`passo_xxxx`), mostra apenas "Passo N" baseado na ordem.
- Aplicar nos cards de mídia e na listagem de steps.

## 4. Link curto personalizado de WhatsApp do parceiro

**Problema:** Link `https://wa.me/55119999...?text=...` fica gigante na UI.

**Mudanças:**
- Migration: tabela `consultant_short_links` (`slug` único curto, `consultant_id`, `target_url`, `clicks`).
- Edge function `s` (rota `/s/:slug`) faz 302 para o `target_url` e incrementa `clicks`.
- Gerar slug curto automaticamente (`igreen.cloud/s/bruna` ou similar) por consultor.
- Exibir só o link curto no painel do parceiro com botão "Copiar".

## 5. Polish geral — Atendente de IA + Templates

**Escopo:**
- `src/pages/AdminFluxoB.tsx`, painel de templates, lista de mídias:
  - Tipografia consistente (heading display, body refinado).
  - Cards com `border border-border/40 bg-card/40 backdrop-blur`.
  - Estados vazios com ilustração + CTA claro.
  - Microinterações (hover lift, transição 200ms).
  - Reescrever copy: títulos diretos, descrições curtas, sem jargão técnico.
  - Botões de ação agrupados, ícones com label, confirmações com motivo.
- Revisar funcionalidades quebradas: upload de mídia, troca de áudio, toggle público/privado, exclusão com X.

## 6. Wizard de configuração de mídias pós-venda (antes de confirmar)

**Objetivo:** Antes do parceiro clicar "Confirmar" nos clientes aprovados, mostrar um popup que o ajude a configurar suas mídias para cada estágio.

**Novo componente `src/components/whatsapp/PosVendaSetupWizard.tsx`:**
- Trigger: ao abrir o CRM pela 1ª vez OU quando faltar mídia em algum estágio, OU ao tentar "Confirmar todos" sem ter mídias setadas.
- 6 abas/steps: **Aprovado, Reprovado, 30d, 60d, 90d, 120d**.
- Para cada estágio, 4 slots opcionais: **Texto, Áudio, Imagem, Vídeo**.
- Cada slot tem 2 opções claras:
  - **"Usar o nosso"** (mídia pública padrão da Fluxo D, preview inline)
  - **"Subir o meu"** (upload + preview + trocar)
- Botão "Pular" por estágio (usa padrão público).
- Barra de progresso no topo (1/6, 2/6...).
- Ao terminar: salva referências em `consultant_pos_venda_media` (nova tabela) e libera o botão "Confirmar todos".

**Migration:** tabela `consultant_pos_venda_media` (`consultant_id`, `stage` ∈ {aprovado,reprovado,d30,d60,d90,d120}, `text`, `audio_media_id`, `image_media_id`, `video_media_id`, `use_default boolean`).

**Backend reaquecimento:** atualizar `pos-venda-bucket-cron` (ou a edge que dispara as mensagens dos buckets) para ler `consultant_pos_venda_media` antes do fallback público.

## Detalhes técnicos

- RPCs novas: `confirm_pending_classification` (estendido), `upsert_pos_venda_media`.
- RLS: consultor lê/escreve só suas próprias linhas em `consultant_pos_venda_media`; service_role full.
- Edge function `s` lê `consultant_short_links` com service_role.
- Sem mudanças no engine v3 do bot — só consumo de novas tabelas no disparador pós-venda.
- UI usa tokens semânticos existentes (sem cores hardcoded).

## Ordem de implementação

1. Migrations (invalid flag, short_links, pos_venda_media) + RPCs.
2. Botão invalidar + visual do popup.
3. prettyStepLabel + aplicação nos templates.
4. Wizard pós-venda.
5. Short link + edge `s`.
6. Polish geral (IA/templates).