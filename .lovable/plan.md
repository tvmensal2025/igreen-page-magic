# Plano — composer estável + leads de tráfego em Captação

Três frentes, todas pequenas e isoladas. Nenhuma muda regra de negócio nem fluxo do bot.

## 1) Acabar com o "expande e carrega" ao enviar etapa

O culpado é o `FlowQuickBar` (botão ⚡ Enviar passo do fluxo) dentro do `MessageComposer`. Hoje:

- Toda vez que o popover abre, `onOpenChange` chama `setLoading(true)` **antes** do estado interno saber se já tem dados em cache → o painel encolhe (spinner) e cresce de novo.
- O Efeito 1 (variantes) e o Efeito 2 (passos) disparam em sequência e cada um liga/desliga `loading`, gerando duplo flicker.
- O botão trigger troca o ícone `Zap` por `Loader2` + badge `1/1` enquanto envia → a barra de ferramentas inteira do composer reflowa (largura do botão muda) e o textarea ao lado "pula".
- Quando o envio termina, o popover fecha → composer reflowa de volta. Se o usuário reabre, o ciclo se repete.

Correções:

- **Cache por consultor/variante** dentro do `FlowQuickBar` (Map em ref): ao reabrir o popover, mostra imediatamente os passos já carregados; revalida em background sem mexer no `loading` visível.
- **Um único `loading`** controlado pelo Efeito 2 (carregar passos). Remover o `setLoading(true)` do `onOpenChange` e o `setLoading(false)` solto do Efeito 1.
- **Trigger com largura fixa**: o botão ⚡ fica sempre `h-9 w-9` (já é), mas trocar `Loader2` por um overlay absoluto sobre o `Zap` em vez de substituir o ícone, para não mudar o tamanho. O badge `1/1` continua `absolute -top-1 -right-1`, sem afetar layout.
- **Altura mínima fixa do `PopoverContent`** (`min-h-[280px]`) para não "pular" entre estado de loading e lista carregada.
- **Composer não reflowa durante envio**: enquanto `sending` for true, manter `min-h` do shell e não desmontar a barra de chips de anexo/imagem pendente (só desabilitar). Hoje `file.attachedFile` some logo após o `await onSendMedia`, mudando a altura no meio do envio.

## 2) Leads de tráfego não aparecem em Captação

Diagnóstico no banco:

- `captured_leads` só tem 1.012 registros, **100% canal `research`** (pesquisa B2B). Zero de `meta_leadads`, `ctwa`, `landing`.
- `customers` tem 8 com `lead_source` de anúncio e 51 leads de WhatsApp; **nenhum tem `ctwa_clid`** populado.
- O `meta-leadads-webhook` está implementado e grava em `captured_leads` via `ingestLead`, mas só dispara se o Meta tiver o webhook `leadgen` assinado **e** `PAGE_ACCESS_TOKEN` + `META_VERIFY_TOKEN` + `FACEBOOK_APP_SECRET` configurados. Hoje nada chega.
- Leads que vêm de anúncio CTWA caem direto no `customers` via `evolution-webhook` / `whapi-webhook` e nunca passam por `captured_leads` — por isso a aba Captação aparece vazia mesmo com leads novos chegando.

Correções:

- **Espelhar lead de tráfego em `captured_leads`** quando o webhook do WhatsApp identificar origem de anúncio (campos `referral`/`ctwa_clid`/`source_id` do payload Evolution+Whapi ou frase-âncora detectada pelo `meta-ctwa-fallback`). Chama o `ingestLead` com `channel: "ctwa"`, mesmo `consultant_id` que recebeu o lead, e marca `status: "converted"` se já virou conversa — assim o painel mostra o histórico e o anti-repetição funciona.
- **Backfill leve**: edge function pontual `captacao-backfill-ctwa` que varre `customers` dos últimos 60 dias com `lead_source` de anúncio ou `ctwa_clid` e popula `captured_leads` (idempotente — `ingestLead` já deduplica).
- **Exibir o canal "WhatsApp (anúncio)" no painel**: o `CapturedLeadsPanel` já tem `ctwa` no enum, só falta um filtro padrão menos restritivo (hoje começa em `status=new`, escondendo os convertidos vindos do WhatsApp). Mudar default para `status=all` e deixar "Novos" como atalho.
- **Diagnóstico visível**: se `meta-leadads-webhook` não estiver recebendo há >7 dias, mostrar aviso no topo do painel com link para o `IntelDiagnostic` que já existe na aba Captação do superadmin.

## 3) Outros pontos que apareceram na auditoria

- **`DialogContent` sem `DialogDescription`** (warning de a11y nos logs) no `CapturedLeadsPanel` — já tem `<DialogDescription>` no dialog principal, mas o `BusinessResearchDialog` ou um outro filho dispara o warning. Adicionar descrição ou `aria-describedby={undefined}` explícito.
- **`bulk_campaign_targets` paginado**: `listAlreadyDispatchedPhones` busca `status in ('sent','sending')` sem `limit` — em consultor com muita campanha pode estourar 1000 linhas (default do supabase-js). Paginar em loop de 1000.
- **Empty state confuso**: quando `hideSent` está ligado e tudo virou "já enviado", o texto explica, mas o botão para alternar fica longe. Adicionar CTA inline no empty state.

## Arquivos previstos

```text
src/components/whatsapp/FlowQuickBar.tsx        # cache + 1 loading + trigger sem reflow
src/components/whatsapp/MessageComposer.tsx     # min-h do shell durante sending
src/components/captacao/CapturedLeadsPanel.tsx  # default status=all, empty state, dialog a11y
src/services/capturedLeads.ts                   # paginação em listAlreadyDispatchedPhones
supabase/functions/evolution-webhook/...        # espelhar lead ads → captured_leads
supabase/functions/whapi-webhook/...            # idem
supabase/functions/captacao-backfill-ctwa/      # nova edge (backfill idempotente)
```

Nenhuma migration de schema — `captured_leads` já aceita `channel='ctwa'` e `status='converted'`.

## Validação

- Build + typecheck.
- Abrir `/admin` → aba WhatsApp → clicar ⚡ várias vezes, alternar A/B/C/D, enviar passo: painel não pode "piscar de tamanho" nem mover o composer.
- Aba Captação: chamar a edge de backfill, conferir que leads com `lead_source` de anúncio passam a aparecer.
- Reexecutar `listAlreadyDispatchedPhones` num consultor com >1k disparos e confirmar que todos os telefones vêm marcados.
