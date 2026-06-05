# Mensagens Automáticas — visual novo + escolha de template

## Sobre os "consultores"
Cada **consultor** é um usuário cadastrado na plataforma (tabela `consultants`, vinculado a `auth.users`). É ele que recebe os leads no Kanban e dispara as mensagens automáticas pelo WhatsApp dele (Whapi ou Evolution). Como você ainda está montando a plataforma, ninguém foi cadastrado — por isso o cron de auto-progressão e as mensagens automáticas não têm para quem enviar ainda. Quando você convidar o primeiro consultor (via tela de admin → "Parceiros / Consultores"), ele aparece como destinatário e o sistema passa a funcionar normalmente. Nenhuma mudança técnica é necessária para "ativar" — é só ter pelo menos um consultor com WhatsApp conectado.

## O que vai mudar no modal "Mensagens Automáticas"

### 1. Visual mais limpo e fácil de entender
Hoje o card de cada mensagem é cinza, denso e com tipografia minúscula (10px). Vamos:
- Cabeçalho da mensagem com número grande ("Mensagem 1", "Mensagem 2"), ícone do tipo selecionado e botão lixeira destacado à direita.
- Separar visualmente em **3 blocos** dentro do card, com títulos pequenos:
  1. **Tipo da mensagem** — botões maiores (Texto · Imagem · Vídeo · Áudio) com o ativo em verde sólido.
  2. **Conteúdo** — campo de texto OU player de mídia, ocupando largura cheia.
  3. **Opções** — delay, imagem opcional antes, motivo (se reprovado), origem (se 30/60/90/120 dias) — colapsáveis num "Mostrar opções avançadas" para reduzir poluição.
- Aumentar fontes para 12-13px (legível) e usar tokens `bg-card`, `border-border`, `text-foreground`.
- Hover/active states e espaçamento generoso entre cards (gap-4).

### 2. Botão "Usar template salvo" (a novidade principal)
Acima do botão "+ Adicionar Mensagem", colocar um botão secundário **"📋 Usar template salvo"** que abre um popover com **2 abas bem claras**:

```
┌─────────────────────────────────────┐
│ [🌐 Públicos]   [👤 Meus templates] │
├─────────────────────────────────────┤
│ 🔍 Buscar...                        │
│ ─────────────────────────────────── │
│ 📝 Boas-vindas energia              │
│    "Olá {{nome}}, quero saber..."   │
│ ─────────────────────────────────── │
│ 🎤 Áudio - Apresentação             │
│    Template de voz · 3 blocos       │
└─────────────────────────────────────┘
```

- **Aba "Públicos"** → `message_templates` onde `is_public = true` (templates da plataforma, disponíveis para todos).
- **Aba "Meus templates"** → `message_templates` do próprio consultor (`consultant_id = atual` e `is_public = false`) + **templates de voz** (`voice_templates` do consultor) misturados na mesma lista, marcados com ícone 🎤.
- Ao clicar num template:
  - **Texto/Imagem/Vídeo** → cria nova mensagem com o `content`, `media_type`, `media_url`, `image_url` preenchidos.
  - **Voz** → renderiza o template de voz na hora (usando `renderTemplate` do `useVoiceTemplates` — costura áudio com nome do lead), cria mensagem tipo "audio" com a URL gerada.
- Campo de busca filtra por nome do template.
- Texto de ajuda no topo da aba: "🌐 Templates públicos foram criados pela plataforma e estão disponíveis para todos os consultores" / "👤 Templates que você criou ou áudios que você gravou".

### 3. Pequenas melhorias de UX
- Mover o título da etapa ("Valor da conta") para um chip colorido grande no header.
- Adicionar contagem: "Mensagem 1 de 3" no topo de cada card.
- Botão "Salvar" fica fixo no rodapé com sombra (sticky) — em listas longas o usuário não precisa rolar.
- Estado vazio (sem mensagens) com ilustração simples e dois CTAs grandes lado a lado: **"+ Criar mensagem em branco"** e **"📋 Usar template salvo"**.

## Detalhes técnicos

**Arquivos a alterar:**
- `src/components/whatsapp/StageAutoMessageConfig.tsx` — redesign visual + integração com novo picker.
- **Novo:** `src/components/whatsapp/TemplatePickerPopover.tsx` — popover com tabs Públicos/Meus, lista combinada de `message_templates` + `voice_templates`, busca, e callback `onPick(template)`.

**Dados:**
- Já existe `message_templates.is_public` (boolean) — usado para separar abas.
- `useTemplates(consultantId)` já busca todos templates via RLS; vamos filtrar client-side por `is_public`.
- `useVoiceTemplates(consultantId)` já existe e expõe `templates` + `renderTemplate(templateId, leadName)` que devolve URL do áudio costurado.
- Como o áudio de voz precisa do nome do lead (que só existe em runtime), no contexto de "mensagem automática salva" vamos gravar apenas o **ID do voice template** num novo campo opcional. Para isso adicionar coluna `voice_template_id uuid null` em `stage_auto_messages` (com FK para `voice_templates(id) on delete set null`) + GRANT. No envio (cron `crm-auto-progress`), se `voice_template_id` estiver preenchido, chamar `renderTemplate` com o nome real do lead antes de enviar como áudio. Mensagens de texto/imagem/vídeo continuam funcionando exatamente como hoje.

**Não muda:**
- Lógica de envio (Whapi/Evolution unificada já implementada).
- Tabelas existentes além da nova coluna `voice_template_id`.
- Permissões / RLS (templates públicos já são legíveis por todos via policy existente).

## O que NÃO está no escopo
- Cadastro de consultores (já existe na aba Parceiros).
- Criar/editar templates públicos (já existe na tela de Templates do Admin).
- Mexer no Kanban em si — só o modal de configuração de mensagens.
