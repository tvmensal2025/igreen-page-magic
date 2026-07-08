## Objetivo

Ligar o Tor no `worker-igreen-sync` sem tocar em nada do Evomi. Como você já tirou as variáveis de proxy do EasyPanel, basta o worker ativar o Tor sozinho quando não houver proxy externo configurado.

## Única mudança de código

**Arquivo:** `worker-igreen-sync/server.mjs` (bloco ~linhas 49–56)

Hoje o Tor só liga se `IGREEN_USE_TOR=1` estiver setado explicitamente. Vou mudar o **default** para ligado quando não existir proxy externo. Fica assim:

- Se houver `PROXY_URL`/`PROXY_SERVER` no ambiente → usa proxy externo (Evomi, quando você reativar). Comportamento atual, intocado.
- Se **não** houver proxy externo e `IGREEN_USE_TOR` não estiver setado → **liga Tor** (novo default).
- Se `IGREEN_USE_TOR=0` explicitamente → acesso direto (para debug).

Toda a lógica do Evomi (`parseProxyEnv`, `buildStickyPassword`, prioridade em `pickProxyConfig`) permanece exatamente como está. Nenhuma linha do bloco de proxy externo é removida ou alterada.

## Passos operacionais

1. Editar só o default de `USE_TOR_FLAG` no `server.mjs`.
2. No EasyPanel: **Rebuild** do serviço `igreen-sync-worker` (nada de env pra mexer — você já tirou o proxy).
3. Conferir no boot log: `mode` deve mostrar `tor+playwright+api-vo-v18` e `pickProxyConfig` deve logar `kind: tor`.
4. Disparar um `POST /sync-all` de teste por um consultor. Se o Cloudflare aceitar → ótimo. Se retornar `igreen_waf_blocked` → o Tor não passa e a única saída é reativar Evomi colando `PROXY_URL` de volta no EasyPanel (sem mexer no código).

## Como reativar Evomi depois

Você cola `PROXY_URL=http://usuario:senha@host:port` no EasyPanel e reinicia. O código já dá prioridade automática ao proxy externo sobre o Tor — não precisa mexer em mais nada.
