# Não misturar leads de Captação com Conversão

Entendi: os `captured_leads` (formulário Facebook, busca por cidade) ficam na aba **Captação**. O botão de Conversão não vai mais promovê-los.

## O que muda

1. **Edge Function `admin-promote-parked-leads`** — remover completamente o bloco que lê `captured_leads` e cria `customers`. A função passa a fazer só:
   - Reset de `pos_venda_stage=NULL` em `customers` do consultor autenticado, onde `customer_origin` **não é** `igreen_sync` e o cliente foi criado nos últimos 120 dias.
   - Retorna `{ reactivated, scanned }`.

2. **Cockpit de Conversão** — renomear o botão para **"Reativar parados (120d)"** e ajustar o toast (sem mencionar "promoção" ou "captação").

## Resultado

- Captação continua intocada, com os leads originais.
- Conversão só puxa clientes que já são `whatsapp_lead`/`manual` do consultor e estavam sem estágio no funil.

## Detalhes técnicos

- Nenhuma migração: só edita `supabase/functions/admin-promote-parked-leads/index.ts` e `src/components/admin/conversao/ConversaoCockpit.tsx`.
- `igreen_sync` continua explicitamente excluído.
