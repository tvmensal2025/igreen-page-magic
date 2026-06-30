## Teste real de envio (texto + áudio + imagem) do pós-venda

### Como vou testar sem bagunçar dados

1. **Descobrir seu número de admin** consultando `auth.users` + `consultants` para pegar o `phone_whatsapp` cadastrado.
2. **Criar um customer de teste** apontando para o seu próprio número, marcando `customer_origin='manual'` e `pos_venda_stage='espera'` (não polui métricas de carteira).
3. **Disparar `pos-venda-auto-progress**` via `supabase--curl_edge_functions` em modo dirigido — passando o `customer_id` e `target_stage=d30` (se a function não suportar parâmetro, faço update direto em `customers.pos_venda_stage='d30'` + `pos_venda_approved_at=now()` e chamo o cron, que detecta e envia).
4. **Verificar no seu WhatsApp** se chegaram as 3 mídias do estágio d30 (texto, áudio, imagem) — e conferir o registro em `customer_auto_message_log` com `status='sent'`.
5. **Cleanup**: apagar o customer de teste e a linha do log.

### O que vou precisar confirmar de você antes

- Seu número de WhatsApp (formato `5511989000650`) **OU** autorização para eu pegar o que está no seu cadastro de consultant.
- Qual estágio testar primeiro: **d30** (recomendado) ou outro?

### Risco

Nulo para os clientes reais — o registro de teste é isolado, não conta como aprovação de carteira, é deletado ao final, e o envio respeita as regras normais de horário e canal (Evolution/Whapi do seu consultant).

### Saída esperada

Te respondo com: número usado, prints dos logs da edge function, e confirmação de que chegou no seu WhatsApp. Se algo falhar (canal off, áudio quebrado, etc.) eu já corrijo na sequência.  
  
pode mandar para o 11989000650