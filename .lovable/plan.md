# Plano — Quick View completo do Lead/Cliente com preview de mensagens

Hoje o ícone do olho (`CustomerQuickViewDialog`) só mostra dados cadastrais. O usuário quer ver, no mesmo clique:
- quando o lead/cliente foi cadastrado, aprovado, reprovado e quando vai entrar em 30/60/90/120 dias
- qual será a próxima mensagem automática que o sistema vai enviar, com **preview real** (texto, áudio com player, imagem em miniatura, vídeo embed)
- tudo bem dimensionado tanto no celular quanto no desktop

## 1. Reescrever `CustomerQuickViewDialog` em um layout responsivo com 3 blocos

Trocar o dialog estreito atual por um **layout adaptativo**:
- `max-w-md` no mobile, `max-w-2xl` no desktop, com `max-h-[90vh] overflow-y-auto`
- 3 abas (`Tabs` do shadcn): **Dados** · **Linha do tempo** · **Próxima mensagem**
- Cabeçalho fixo com nome + telefone + badges grandes (etapa atual, origem, status), legíveis em 360px de largura

Resolve a queixa "tamanho não dá para ver certo".

## 2. Bloco "Linha do tempo" (timeline real)

Calcular eventos a partir das colunas já existentes em `customers` / `crm_deals`:

| Evento | Fonte |
| --- | --- |
| Cadastrado | `data_cadastro` / `created_at` |
| Entrou em análise | `portal_submitted_at` |
| Aprovado | `data_ativo` / `approved_at` |
| Reprovado | `rejected_at` + `rejection_reason` |
| 30 / 60 / 90 / 120 dias | `portal_submitted_at + N dias` (mostra "faltam X dias" se futuro, "há X dias" se passado) |
| Última msg automática enviada | `customer_auto_message_log` (último registro por `stage_key`) |

Render: lista vertical com bolinha colorida (mesmas cores das colunas do kanban), data em `dd/MM/yyyy HH:mm`, e label.

## 3. Bloco "Próxima mensagem" (preview real)

Buscar do `kanban_stages` a configuração da **próxima etapa** que esse cliente/lead vai cair (ex.: hoje está em `aprovado`, próxima é `d30`):
- Calcular `nextStage` via mesma lógica de `computeStage` + offsets de 30/60/90/120
- Carregar `auto_message_enabled`, `auto_message_text`, `auto_message_type`, `auto_message_media_url`, `auto_message_image_url` daquela etapa
- Renderizar preview conforme `auto_message_type`:
  - **text** → balão WhatsApp simulado (fundo verde-escuro, bolha à direita) com `{{nome}}` substituído pelo nome real
  - **audio** → `<audio controls>` apontando para `auto_message_media_url` + duração
  - **image** → `<img>` em miniatura clicável (abre em nova aba)
  - **video** → `<video controls>` com poster
- Mostrar também: "Será enviada em **DD/MM/YYYY** às **HH:00**" (baseado em `portal_submitted_at + N dias` e janela do cron horário)
- Se `auto_message_enabled = false`, mostrar aviso "Autoprogressão desativada para esta etapa" com link para abrir `PosVendaAutoConfigDialog`

Também mostrar a **mensagem que já foi enviada** na etapa atual (vinda de `customer_auto_message_log`) com o mesmo formato de preview, para o usuário saber exatamente o que o cliente recebeu.

## 4. Aplicar o mesmo quick view aos LEADS (CRM Leads)

Hoje `KanbanDealCard` já tem o botão de olho que abre `CustomerQuickViewDialog` quando há `customer_id`. Para leads **sem** `customer_id` (só `crm_deals`):
- Adicionar um modo `dealId` no mesmo componente
- Carregar de `crm_deals` + `kanban_stages` do consultor, calcular próxima etapa e preview da mensagem do `auto_message_*` daquela stage
- Mostrar linha do tempo do lead: criado, última interação do bot (`last_step_advanced_at`), aprovado/reprovado

## 5. Responsividade

- Grid de badges no header: `flex-wrap gap-1.5`
- Abas: `grid-cols-3` no desktop, `grid-cols-3 text-[11px]` no mobile
- Áudio/vídeo: `w-full` para preencher o dialog
- Testar em 360px (mobile) e 1280px (desktop)

## Detalhes técnicos

**Arquivos a editar/criar:**
- `src/components/whatsapp/CustomerQuickViewDialog.tsx` — reescrever com Tabs + suportar `customerId | dealId`
- novo `src/components/whatsapp/QuickViewTimeline.tsx` — componente da timeline
- novo `src/components/whatsapp/QuickViewNextMessage.tsx` — preview de mídia
- `src/components/whatsapp/KanbanDealCard.tsx` — passar `dealId` quando não houver `customerId`

**Queries adicionais:**
- `kanban_stages` filtrado por `consultant_id` + `stage_scope` (`leads` ou `pos_venda`) para descobrir config da próxima etapa
- `customer_auto_message_log` (já tem RLS) para histórico de envios

**Sem mudanças de schema** — todas as colunas e tabelas necessárias já existem.

**Sem mudanças em edge functions** — `pos-venda-auto-progress` continua igual; o quick view só lê e renderiza.

## Fora do escopo
- Não mexer no cron, na engine de envio, nas RLS, nem nas cores do kanban (já ajustadas antes)
- Não adicionar edição inline dentro do quick view (continua sendo só visualização — para editar, o usuário abre o cadastro completo)
