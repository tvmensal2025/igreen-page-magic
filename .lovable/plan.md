## Problema 1 — Não dá para deixar só o Fluxo M ativo

**Causa raiz:** existem duas UIs que gravam `consultants.active_variants` e uma "briga" com a outra:

1. `ConsultantVariantsCard` (radio: A/B/D/M/Both) — sobrescreve com `['M']` quando você clica em "Apenas Fluxo M".
2. `VariantDistributionBar` (switches por variante, mostrado dentro do editor de fluxos) — recarrega da base e continua mostrando D ligado; se você mexer nela depois, volta a ativar D.

Hoje o consultor Rafael Ferreira está com `active_variants = ['D','M']` (round-robin metade e metade — dá pra ver nos leads recentes alternando D/M/D/M).

Além disso, o toast "Fluxo D pausado" fica na tela após clicar porque o botão de fechar do toast não é chamado — o mesmo `toast.success` reaparece quando a UI reavalia.

**Correção:**

- **Unificar as duas UIs em uma só fonte de verdade.** Remover o `ConsultantVariantsCard` da tela de configuração do consultor e deixar só um card único com switches independentes (A / D / M / B / C / …), igual ao `VariantDistributionBar`, com regra "no mínimo 1 ativo".
- **Toggle real "liga/desliga" para o D:** quando o switch do D é desligado e o M está ligado, salvar `['M']` sem reintroduzir D.
- **Toast único:** substituir `toast.success` por `toast.message` com `id` fixo por variante (`toast.success(..., { id: 'flow-' + v })`) — assim ao clicar de novo o toast é substituído, não acumulado.
- **Recarregar `activeVariants` após salvar** para não voltar ao estado antigo por race condition.

Sem mexer em `assign_flow_variant`, no webhook nem no schema — só na UI de configuração.

## Problema 2 — Áudio do Fluxo M não reproduz na biblioteca

**Causa raiz:** os áudios do Fluxo M estão salvos como `ai_media_library` com `is_public=true` e `consultant_id=0c2711ad…` (Rafael, o super admin do M). O player `<audio controls src={m.url}>` funciona para `.ogg/opus`, mas parte dos arquivos antigos foi gravada como `.webm` (ex.: `gravacao-1778896961171.webm`) e nem todo browser roda WebM/Opus embutido (Safari desktop falha silenciosamente; iOS idem).

Além disso vários áudios estão com `active=false`, então mesmo quando o player toca no admin, o dispatcher do bot descarta na hora de enviar (regra "active media filter").

**Correção:**

- **Player robusto**: trocar `<audio src>` por `<audio><source src=... type=...></audio>` com `type="audio/ogg; codecs=opus"` deduzido pela extensão, e adicionar `onError` que mostra "Não foi possível reproduzir neste navegador — baixar" com link `download` — assim o usuário sempre consegue ouvir mesmo em Safari.
- **Botão "Converter para ogg"** nos áudios `.webm` (chama o `tts-proxy` ou um novo `audio-transcode` só para re-empacotar em OGG/Opus) — o WhatsApp/Whapi rejeita `.webm` como mensagem de voz; isso é o motivo do "não consegue enviar".
- **Aviso visual "Áudio inativo — não será enviado ao lead"** quando `active=false`, com botão "Ativar", para o super admin identificar rapidamente quais áudios do M estão desligados.

## Arquivos a alterar (apenas UI)

```text
src/components/admin/fluxo-b-ia/ConsultantVariantsCard.tsx    → remover ou reduzir a wrapper do bar
src/pages/Admin.tsx (ou onde o card é montado)                → montar VariantDistributionBar no topo de "Dados do Consultor"
src/components/admin/flow-builder/VariantDistributionBar.tsx  → toast com id fixo, reload após save
src/components/admin/fluxo/StepMediaPanel.tsx                 → player com <source>+onError+download; badge "inativo"
src/components/admin/AIAgentTab/MediaColumn.tsx               → mesma melhoria de player
```

Nova edge function opcional para reencodar webm→ogg (só se você quiser botão "Converter"): sim quero o botao

```text
supabase/functions/audio-transcode-ogg/index.ts
```

## Fora de escopo

- Regras do `assign_flow_variant` / round-robin / trigger de re-alinhamento — já funcionam corretamente para `['M']`.
- Estrutura de `bot_flows` / `bot_flow_steps` do Fluxo M — o M já roda como clone do D.
- `evolution-webhook` e `whapi-webhook`.
- Dispatcher de áudio (regra `active media filter` já é a correta — só vamos deixar claro na UI).

## Dúvida antes de codar

Você quer que eu **remova completamente** o `ConsultantVariantsCard` (o card de radio "A_ONLY/D_ONLY/M_ONLY…") e deixe só a barra de switches, ou prefere manter o card com um design novo tipo "só switches A/D/M/B/C, 1 fluxo mínimo ativo"? Se não responder, sigo com a barra de switches única (mais simples e sem conflito).