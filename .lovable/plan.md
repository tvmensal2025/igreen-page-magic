## Auditoria — o que foi feito nas últimas rodadas

### 1. Banco de dados (já aplicado, sem ação tua)

- **6/6 consultores** agora têm `active_variants = ['D']` (Fluxo D conversacional como padrão).
- **1 regra global** em `flow_router_rules` (`consultant_id=NULL`, `target_flow_key='fluxo_a_cadastro'`, `trigger_keywords=['fazer o cadastro']`, `is_active=true`).
- **6 regras por consultor** já existentes (de rodadas anteriores) — quando o consultor personalizar via UI, sobrescreve a global.

### 2. Edge Functions (auto-deploy pelo Lovable — já no ar)

- `supabase/functions/evolution-webhook/handlers/bot-flow.ts` — detecta keyword "fazer o cadastro" e força `flow_variant='A'` + `conversation_step='aguardando_conta'` imediatamente, respondendo "📸 Me envia agora uma foto da sua conta de luz".
- `supabase/functions/whapi-webhook/handlers/bot-flow.ts` — idem.
- `supabase/functions/resend-portal-link/index.ts` (**nova**) — recebe `customerId`+`consultantId`, busca o link (`link_facial`/`link_assinatura`/`portal2_contract_link`/`igreen_link`), resolve o canal de origem (Evolution/Whapi) e dispara a mensagem com o link ao cliente.

### 3. UI front-end (auto-deploy pelo Lovable — no preview)

- Admin → Fluxo B → **Por Consultor** ganhou:
  - Card de distribuição atualizado: agora tem 4 opções (A direto / D / B / B+D).
  - Novo card **"Palavras-chave do Fluxo A"** — chips editáveis, switch on/off, herda global ou cria override.
- **Captação (`PortalStatusTracker`)**: bloco com link clicável + "Copiar" + botão **"Reenviar link ao cliente"** sempre que houver link.
- **Chat WhatsApp (`ChatView`)**: o mesmo `PortalStatusTracker` agora aparece acima das mensagens — consultor vê status do Portal 2, OTP, link e botão de reenvio sem sair do chat.

### 4. Worker Portal 2 — ⚠️ PRECISA DEPLOY MANUAL

**Aqui mora a única ação que depende de ti.**

O arquivo `worker-portal-2/server.mjs` foi alterado:

- `sendValidationLinkToCustomer` agora envia o link no corpo da mensagem ("Se preferir acompanhar/concluir manualmente, este é o link oficial da iGreen: …").

Mas esse worker **não roda no Lovable nem no Supabase** — roda na tua VPS (Docker / `node server.mjs`). O Lovable só commita o código no repositório. Portanto:

```
✅ Código atualizado no repo
❌ Worker rodando na VPS ainda está na versão antiga
```

Para a mudança do worker entrar em produção, **tu precisa**:

1. Fazer pull do código na VPS (`git pull` no diretório do worker).
2. Reiniciar o container/processo:
  - Docker: `docker compose build worker-portal-2 && docker compose up -d worker-portal-2`
  - PM2 / systemd: `pm2 restart worker-portal-2` ou `systemctl restart worker-portal-2`.
3. Conferir logs para garantir que voltou online (`docker logs -f worker-portal-2` ou `pm2 logs worker-portal-2`).

**Importante:** o fluxo já funciona *sem* esse redeploy, porque:

- O link do facial é enviado no `bot-flow.ts` quando o lead entra em `aguardando_facial` (essa parte é Lovable/Supabase → já no ar).
- O OTP continua sendo enviado normalmente pela iGreen.
- O botão "Reenviar link" no chat e na captação chama a nova edge function (já no ar).

O redeploy do worker só melhora a **primeira mensagem** que sai junto do OTP (passa a incluir o link explícito). Sem o redeploy, o cliente ainda recebe o link mais tarde — quando o bot pedir a selfie — e o consultor pode reenviar a qualquer momento pelo botão novo.

---

## Resposta direta

> **"ajustou o portal2?"**
> Sim, o código do worker foi ajustado, mas **a versão rodando na tua VPS ainda é a antiga**. Precisa redeployar lá para a mensagem inicial com o link entrar em vigor.

> **"preciso ir no portal?"**
> Não no portal da iGreen. Só na VPS do worker (SSH/Docker) para puxar o novo código e reiniciar o processo. Se preferires, posso preparar um script de deploy ou checar se há CI configurado.

---

## Próximo passo proposto

Como o redeploy do worker é fora do Lovable, este é um plano de **revisão** — não há código novo para escrever a menos que tu queiras:

1. **Verificar/criar um workflow de deploy automatizado** (GitHub Actions → SSH → docker pull → restart) para o worker-portal-2.
2. **Ou** posso só te entregar um one-liner de SSH para rodar agora.
3. **Ou** se preferires testar o resto antes (chips de keywords, botão reenviar, conversão por keyword), aprovar este plano sem alteração de código.

Me diz qual caminho seguir. irei fazer manual no easypanel e fazer deploy