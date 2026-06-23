## Parte 1 — Fluxo D já entrega o link do Portal 2?

**Sim, entrega — porque cadastro é compartilhado.** O Fluxo D conduz a conversa até o lead aceitar cadastrar. A partir daí, *todo* lead (D, B ou A) vai para os mesmos `conversation_step` do pipeline determinístico (`aguardando_conta` → `processando_ocr_conta` → ... → `portal_submitting`). O `worker-portal-2/server.mjs` é quem efetivamente:

1. Faz login no Portal iGreen, preenche o formulário, gera o `idcliente`.
2. Monta o `validationLink` (`https://digital.igreenenergy.com.br/validacao-codigo/{idcliente}?id={consultor}&sendcontract=true`).
3. Persiste em `customers.link_facial`, `link_assinatura`, `igreen_link`, `portal2_contract_link`.
4. Dispara `sendValidationLinkToCustomer` — após a edição anterior, **o link agora vai no corpo da mensagem** ("Se preferir acompanhar/concluir manualmente, este é o link oficial da iGreen: …").
5. Move `conversation_step` para `aguardando_otp`.

Depois do OTP validado, o bot entra em `aguardando_facial`/`aguardando_assinatura` (`bot-flow.ts` linhas ~5395-5411 em ambos webhooks) e já responde com o mesmo link:

> 📸 *Última etapa: Validação Facial*
> 👉 Abra este link no seu celular e siga as instruções: {link}

Quando o cliente responde "PRONTO" (ou variações), avança para `cadastro_em_analise`.

**Conclusão:** Fluxo D entrega o link sim, em dois momentos:

- **Momento 1 (após submit do Portal 2):** mensagem da iGreen com OTP + link explícito.
- **Momento 2 (após OTP validado / pedido de facial):** link da selfie.

### Riscos / pontos a fechar

1. **Variante "D" continua em D mesmo após confirmar cadastro?** Sim — só muda para `conversation_step=aguardando_conta`, mas `flow_variant` continua D. Isso é OK, porque o roteador (`flow-router.ts`) já preserva `CADASTRO_STEPS` no engine `sys` independente da variante.
2. **Se o worker falhar antes do `sendValidationLinkToCustomer**` (ex.: portal offline), o link nunca chega. Hoje cai em `aguardando_humano`. Tem watchdog (`flow-d-stuck-watchdog`) mas convém validar que ele cobre esse caso.
3. **Fluxo D tem um "passo final" próprio no Flow Builder** (`complete`) — esse texto é configurável e roda *depois* da análise da iGreen, não interfere no envio do link.

Veredito: **funciona 100%** desde que worker complete o submit e a Evolution/Whapi do consultor esteja online.

---

## Parte 2 — UI para gerenciar tudo (deixar 100%)

Hoje o admin tem `ConsultantVariantsCard` (escolhe D/B/Ambos por consultor) em `/admin/fluxo-b`. **Não existe UI** para:

- Ativar Fluxo A por palavra-chave (`flow_router_rules` com `target_flow_key='fluxo_a_cadastro'`).
- Ver/editar as palavras-chave que ativam o cadastro.
- Incluir a variante **A** na escolha de distribuição (hoje só B/D).

### Plano de UI

#### 2.1 Estender `ConsultantVariantsCard`

- Adicionar opção **"Cadastro direto (Fluxo A)"** ao radio (modo `A_ONLY` → `active_variants=['A']`), além de D/B/BOTH.
- Mostrar contagem de leads em A nos últimos 7 dias junto com B e D.
- Texto explicando: "Fluxo A entra direto em 'envie sua conta de luz'. Use só para captação muito qualificada."

#### 2.2 Novo card `FluxoAKeywordsCard` (mesma página `/admin/fluxo-b`)

- Lista as keywords ativas para o consultor logado em `flow_router_rules` (filtrando `target_flow_key='fluxo_a_cadastro'`).
- Input para adicionar nova keyword (chips) — salva no array `trigger_keywords`.
- Botão remover por chip.
- Toggle "Ativo" (campo `is_active`).
- Aviso: "Quando o cliente digitar uma destas palavras, o bot pula a conversa e pede direto a foto da conta. Não interfere em palavras-chave de parceiros (essas continuam marcando o `referral_partner_id`)."
- Pré-popular com `["fazer o cadastro"]` se o consultor ainda não tem regra (já vem do seed da rodada anterior).

#### 2.3 Card de **status do link Portal 2** na conversa (chat do consultor)

- No painel de conversas, quando `customer.portal2_contract_link` existir, mostrar um card destacado:
  - Status: criado / OTP enviado / OTP validado / facial concluída / aprovado.
  - Botão "Copiar link" + "Reenviar link ao cliente" (chama edge function existente ou um novo POST que dispara `sendValidationLinkToCustomer`).
- Resolve o caso de cliente perdido: consultor reenviza com 1 clique.

#### 2.4 Indicador na lista de leads

- Coluna/badge "Aguardando facial" quando `conversation_step` é `aguardando_facial`/`aguardando_assinatura` há mais de N horas → consultor pode intervir.

### Arquivos a tocar

- `src/components/admin/fluxo-b-ia/ConsultantVariantsCard.tsx` — adicionar opção A.
- `src/components/admin/fluxo-b-ia/FluxoAKeywordsCard.tsx` — **novo**.
- `src/pages/AdminFluxoB.tsx` — montar o novo card.
- Componente de chat do consultor (verificar onde está — `ConsultantPage.tsx` ou subcomponente) — card de status do Portal 2.
- (Opcional) Edge function `reenviar-link-portal` ou rota direta para `worker-portal-2`.

### Testes manuais antes de fechar

1. Lead novo → entra em D (default atual).
2. Lead digita "fazer o cadastro" → vira A imediatamente, recebe "📸 Me envia agora uma foto da sua conta de luz".
3. Lead conclui fluxo D normal → cadastro determinístico → worker dispara → mensagem com link chega ao cliente.
4. No painel admin: trocar consultor para "A_ONLY" → novos leads dele entram direto em A.
5. Adicionar keyword nova ("quero cadastrar") na UI → testar com lead que não está em A.
6. Card de status Portal 2 mostra o link e botão "Reenviar" funciona.

---

## Perguntas antes de construir

1. **Distribuição com A:** quer que A apareça como opção isolada (`A_ONLY`) **e** combinável (`A+D`, `A+B`)? Ou só radio mutuamente exclusivo (4 opções: A / B / D / BOTH B+D)? isolada
2. **Card de status Portal 2:** onde quer mostrar — dentro do chat do consultor (`/consultor/...`) ou também numa página admin separada? dentro do chat
3. **Reenvio do link:** prefere botão que chama o worker-portal-2 (`/send-validation-link/:customerId`, precisa criar endpoint) ou que envia direto via Evolution/Whapi da edge function (`manual-step-send` ou nova)? ele envia direto, mas em chat no whatsapp e no captacao clicando no botao tbm envia no bot
4. **Keyword UI por consultor ou também global?** Hoje a regra pode ter `consultant_id=NULL` (vale pra todos). Quer expor isso na UI ou manter sempre por consultor? todos incicia com essa palavra chave, e vale para todos, mas eles podem mudar
5. &nbsp;