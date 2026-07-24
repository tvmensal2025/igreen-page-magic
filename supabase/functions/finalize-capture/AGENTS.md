# AGENTS — finalize-capture (Portal 2)

Edge viva que finaliza a captação e despacha o cadastro ao Portal 2. Domínio: `#portal2-fluxo-canonico` + `#helpers-canonicos`.

## Antes de editar

1. Reuse `validateForPortal`, `preflightPortalDocuments` e `dispatchPortalWorker`.
2. Portal 2 é o único cadastro vivo; não ressuscite Portal 1.
3. Worker do portal é `portal2_worker_url`, diferente de sync e Club.

## Ordem obrigatória

1. Carregar cliente e bloquear origem `igreen_sync` / `igreen_extension`.
2. Evitar redisparo de estado avançado; falhas recuperáveis podem entrar em retry.
3. Validar todos os campos e documentos no servidor.
4. Executar pré-voo de arquivos baixáveis antes de avisar o cliente.
5. Só então despachar o worker e atualizar o estado.

## Notificação

- `sendNotice` respeita `bot_paused`; pausado só notifica com confirmação explícita da UI.
- Canal deve priorizar Whapi; `needs_reconnect` da Evolution não declara o WhatsApp offline.
- A mensagem é de andamento do cadastro, não uma nova automação em massa.

## NÃO FAÇA

- Despachar documento ausente, inválido ou não baixável.
- Reenviar cadastro de cliente já sincronizado/extensão.
- Bypassar validação, guardas de idempotência ou pausa do bot.
- Usar worker de sync/Club ou remover guardas de origem.
