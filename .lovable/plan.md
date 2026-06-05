# Auditoria do plano anterior + correções (contexto: venda)

## Achados da auditoria


| #   | Problema                                                                                                                                                                                                                                                 | Evidência                                                | Severidade |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ---------- |
| 1   | `**"oii 😊"` quebra contexto de venda** — lead que mandou foto da conta recebe um "oii" do nada, parece bot quebrado                                                                                                                                     | `index.ts:1894` (versão antiga) e `:1880` (versão atual) | 🔴 Alta    |
| 2   | **Sentinel `[empty-reply-safety]` aparece no histórico do admin** — admin chat view não filtra `message_type='system'` (`grep` confirmou)                                                                                                                | `src/components/whatsapp/*` não filtra `system`          | 🔴 Alta    |
| 3   | `**getTemplate(stepToSend, "default")` não funcionaria** — o argumento é `template_key`, não variant; e só ~10 steps têm row em `bot_messages` (consultado agora). Steps como `aguardando_conta`, `d_resultado`, `aguardando_documento` não têm template | `templates.ts:99` + query em `bot_messages`              | 🟡 Média   |
| 4   | **Anti-loop usa `message_text='[empty-reply-safety]'**` — se mudarmos o sentinel pra system message invisível, a query do count quebra silenciosamente; precisa de chave estável                                                                         | Auto-referência no `index.ts:1888-1898`                  | 🟡 Média   |


## Solução (Camada 2 re-projetada)

### Estratégia: re-enviar a última pergunta real do bot

Em vez de inventar texto, o bot **re-emite a última pergunta que ele mesmo fez** ao lead, com um prefixo humano leve. Isso preserva 100% o contexto da venda — se o passo era pedir conta de luz, ele repete pedindo conta de luz.

**Pseudocódigo da Camada 2:**

```ts
if (!finalReply && !handlerSentInline) {
  // 1) Busca o ÚLTIMO outbound real (não sentinel, não inline-marker)
  //    enviado a este customer nos últimos 30 min, com texto não vazio.
  const { data: lastReal } = await supabase
    .from("conversations")
    .select("message_text, conversation_step, created_at")
    .eq("customer_id", customer.id)
    .eq("message_direction", "outbound")
    .neq("message_type", "system")          // ignora sentinels
    .not("message_text", "like", "[inline-sent]%")
    .not("message_text", "like", "[failed:%")
    .not("message_text", "is", null)
    .gte("created_at", new Date(Date.now() - 30 * 60_000).toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let repromptText: string | null = null;

  if (lastReal?.message_text && lastReal.message_text.trim()) {
    // 2a) Prefixo humano + última pergunta real. Curto, sem robotice.
    const firstName = (customer.name || "").split(" ")[0];
    const greet = firstName ? `${firstName}, ` : "";
    repromptText = `${greet}voltando aqui 👇\n\n${lastReal.message_text}`;
  } else {
    // 2b) Sem histórico recente → tenta template do step atual em bot_messages.
    //     Convenção: template_key="reprompt" (criamos abaixo). Se não houver,
    //     cai em "menu_inicial:reforco" que já existe e é tom de venda.
    try {
      repromptText = await getTemplate(
        supabase,
        String(stepToSend ?? "menu_inicial"),
        "reprompt",
        { nome: customer.name, representante: nomeRepresentante,
          valor_conta: customer.electricity_bill_value },
      );
    } catch { /* fallback no catch abaixo */ }
    if (!repromptText || repromptText.trim() === "") {
      repromptText = await getTemplate(
        supabase, "menu_inicial", "reforco",
        { nome: customer.name, representante: nomeRepresentante },
      );
    }
  }

  finalReply = repromptText || `${(customer.name||"").split(" ")[0] || "Oi"}, posso te ajudar a continuar?`;
}
```

### Bloqueio de variáveis órfãs

`renderTemplate` em `templates.ts:57` já limpa pares órfãos (`**`, `,,`, etc.), mas **não limpa `{{xxx}}` desconhecido**. Adicionamos uma checagem pós-render:

```ts
// Em templates.ts no fim de renderTemplate, antes do return:
if (/\{\{\s*\w+\s*\}\}/.test(out)) {
  // Há variável não resolvida — não usar este texto cru no re-prompt.
  // Devolvemos string vazia para o caller cair no próximo fallback.
  return "";
}
```

Aplicado **só dentro de `renderTemplate**`, evita que um template novo com variável errada vaze `{{cpf}}` pro cliente.

### Sentinel invisível para o admin

Mudar o sentinel pra um marcador que admin filtra. Como o admin **não filtra `message_type='system'**`, em vez de criar mais filtros no frontend, fazemos o sentinel com **prefixo textual reservado** já filtrado em todas as queries de display:

```ts
await supabase.from("conversations").insert({
  customer_id: customer.id,
  message_direction: "outbound",
  message_type: "system",
  message_text: "[__safety_ping__]",   // novo marker, não-localizado
  conversation_step: stepToSend ? String(stepToSend) : null,
});
```

E **adicionamos um filtro no admin chat view** (componentes que listam `conversations` ordenados por `created_at`) para excluir `message_text LIKE '[__safety_ping__]%'` E `message_text LIKE '[inline-sent]%'` E `message_text LIKE '[failed:%'`. Vou listar os componentes exatos no momento do build (`grep "from(\"conversations\")"` nos `src/`).

### Camada 3 (anti-loop) ajustada

Mesmo critério (3× em 5min), mas chave estável usando o novo marker:

```ts
const { count } = await supabase
  .from("conversations")
  .select("id", { count: "exact", head: true })
  .eq("customer_id", customer.id)
  .eq("conversation_step", String(stepToSend ?? ""))
  .eq("message_text", "[__safety_ping__]")
  .gte("created_at", new Date(Date.now() - 5 * 60_000).toISOString());

if ((count ?? 0) >= 2) {
  // Pausa pra humano com motivo claro
  await supabase.from("customers").update({
    bot_paused: true,
    bot_paused_reason: "anti_loop_empty_reply",
    bot_paused_at: new Date().toISOString(),
  }).eq("id", customer.id);
  // E grava 1 outbound visível avisando que humano vai assumir:
  finalReply = `${(customer.name||"").split(" ")[0] || ""}, vou chamar um consultor humano agora mesmo pra continuar com você 🤝`.trim();
}
```

Diferença vs. plano anterior: quando pausa por loop, o cliente **recebe um aviso humano** em vez de silêncio total — silêncio em venda perde lead.

## Arquivos a alterar (build mode)

1. `supabase/functions/evolution-webhook/index.ts` — substituir bloco Camada 2 (linhas ~1878-1925 da versão atual) pela lógica acima.
2. `supabase/functions/evolution-webhook/handlers/conversational/templates.ts` — adicionar guard de `{{}}` órfão no fim de `renderTemplate`.
3. **Sem migração nova obrigatória**, mas opcional: SQL pra inserir `reprompt` templates para os steps mais críticos (`aguardando_conta`, `aguardando_documento`, `d_resultado`, `dados_basicos`). Posso listar os textos pra você aprovar antes de inserir.
4. **Filtro no frontend admin chat**: localizar (`grep`) e atualizar 1-3 componentes que listam `conversations` pra excluir `[__safety_ping__]%`, `[inline-sent]%`, `[failed:%`.

## Validação

1. **Lead após mandar conta + cair em empty-reply**: deve ver `"João, voltando aqui 👇\n\nManda uma foto ou PDF…"` em vez de `"oii"`.
2. **Lead novo sem histórico**: cai em `menu_inicial:reforco` ("ainda quer entender como funciona o desconto?") — tom de venda.
3. **Sentinel `[__safety_ping__]**` invisível no painel admin após o filtro.
4. **3× empty-reply em 5min** no mesmo step → pausa com `anti_loop_empty_reply` + mensagem "vou chamar um consultor humano".
5. **Template com `{{erro}}` não resolvido** → `renderTemplate` retorna vazio, cai no próximo fallback, nunca chega ao cliente.

## Itens NÃO incluídos

- Re-prompt via IA generativa (custo + latência sem ganho claro vs. re-emit do último real).
- Inserção em massa de templates `reprompt` por step — proposto como opcional, aguardando aprovação dos textos.

