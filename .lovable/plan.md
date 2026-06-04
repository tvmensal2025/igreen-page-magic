## Diagnóstico

O erro **"Número fora do padrão BR"** que aparece no card do Rafael Ferreira **não tem nada a ver com o fluxo D, com botões ou com a paridade Evolution/Whapi**. É um bug de dado: o telefone está corrompido no banco.

### O que o banco mostra

```text
customer_id: 7aa1876f-0c17-4f56-ab8b-9d68038257fa
name:        Rafael Ferreira
consultant:  tvmensal01  (não rafael.ids@icloud.com)
flow_variant: D
phone_whatsapp: 55121380171473111   ← 17 dígitos!
```

O padrão BR válido é 12 ou 13 dígitos (`55` + DDD + 8/9). Esse lead tem `55` + `121380171473111` (15 dígitos extras). A UI mostra os 15 dígitos sem o DDI (`121380171473111`).

A validação em `supabase/functions/manual-step-send/index.ts` (linhas 116-135) está **correta** e rejeita com `phone_invalid_format` antes mesmo de tentar enviar — por isso nenhum passo do fluxo dispara, independente de ser variante A, D, com botão ou sem.

### Sobre "fluxo D do Rafael vs tvmensal01"

O lead pertence ao consultor **tvmensal01** (não [rafael.ids@icloud.com](mailto:rafael.ids@icloud.com)). Selecionar a variante D no card só muda qual `bot_flows` do **tvmensal01** será usado — não importa fluxo de outro consultor. Cada consultor tem o seu próprio conjunto de `bot_flows` (A/B/C/D/E). O motor (Evolution, com as correções da auditoria anterior) só roda depois da validação de telefone passar.

### Causa raiz do número corrompido

Vou precisar verificar como esse lead foi criado (Excel? captação? handoff manual?) — `55121380171473111` parece ser concatenação dupla de um JID ou paste acidental. Os candidatos:

- Importação Excel sem sanitização (`importLeadsExcel` / RPC `import_leads_*`)
- Função de criação de lead que concatena `55` quando já vem com `55…`
- Webhook que gravou `from`+`fromMe` juntos

## Plano (após sua aprovação)

1. **Corrigir o telefone do lead Rafael Ferreira** (id `7aa1876f…`).
  - Preciso que você me diga qual é o número real do Rafael (11 dígitos, ex: `11999887766`) — não consigo adivinhar quais dos 15 dígitos são os corretos.
  - Aplico `UPDATE customers SET phone_whatsapp = '55XXXXXXXXXXX' WHERE id = '7aa1876f-0c17-4f56-ab8b-9d68038257fa'` via migração.
2. **Auditar a origem do bug de gravação** (read-only):
  - `customer_origin`, `created_at` e logs próximos para identificar qual rota criou esse registro.
  - Varrer `customers` por `length(regexp_replace(phone_whatsapp,'\D','','g')) > 13` para ver quantos outros leads estão quebrados.
3. **Hardening na escrita** (após confirmar a rota):
  - Adicionar normalização única `normalizeBrPhone()` no ponto de entrada culpado, rejeitando ≥14 dígitos antes de gravar.
  - Opcional: trigger `BEFORE INSERT/UPDATE` em `customers.phone_whatsapp` validando `length(only_digits) IN (10,11,12,13)`.
4. **Validar envio do fluxo D** com o telefone correto:
  - Após o UPDATE, reenviar passo 1 pelo painel. Como variante=D e o Evolution já está com as correções da auditoria anterior (`toEvolutionNumber`, `evolution_message_id`, fallback de botões), o fluxo D do tvmensal01 deve disparar normalmente.

### O que **não** vou tocar

- Whapi (segue intocado, conforme regra).
- `_shared/evolution-api.ts` (já validado na auditoria anterior).
- Fluxo de outro consultor ([rafael.ids@icloud.com](mailto:rafael.ids@icloud.com)) — irrelevante aqui. MAS EU DEIXEI O FLUXO D DO SUPERADMIN COMO PUBLICO

### Pergunta antes de implementar

**Qual o número real do Rafael Ferreira (lead `7aa1876f…` do tvmensal01)?** Sem isso só consigo limpar o registro (apagar) ou marcar como `sem_celular_*`.  
  
numero: 11989000650 