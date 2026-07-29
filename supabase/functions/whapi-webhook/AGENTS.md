# AGENTS — whapi-webhook (inbound primário)

Canal **Whapi** é a fonte de verdade do WhatsApp. Evolution aqui é só paridade/legado.

## Antes de editar

1. Leia `.kiro/steering/mapa-dominios.json` → id `wa-webhook`
2. Regras: Whapi primário · UUID campanha · nome seguro · dedup `webhook_message_dedup`
3. Chat = tabela `conversations` (não existe `messages`)

## Mapa rápido deste diretório

| Arquivo | Papel |
|---|---|
| `index.ts` | Entrada webhook, auth, ACK, roteamento |
| `handlers/conversational/` | Conversa / Cérebro / handoff |
| `handlers/bot-flow.ts` | Fluxo legado grande — **não “reescrever” sem pedido** |

## NÃO FAÇA

- Pedir reconnect Evolution por `whatsapp_instances.needs_reconnect`
- Quebrar paridade com `evolution-webhook` sem checklist
- Importar `_shared/vendedora/` (morto) — produção = `_shared/cerebro/resposta-hook.ts`
- Ligar automação em massa nova daqui

## Helpers canônicos

`_shared/channel-sender.ts` · `_shared/deterministic-campaign-resolver.ts` · `_shared/customer-display-name.ts` · `_shared/bot/dedupe.ts` · `_shared/bot/global-flag.ts` · `_shared/bot/sofia-post-bill-routing.ts` (OCR conta/doc **sem** SIM no happy path)

## OCR pós-anexo (2026-07)

- OCR bom → avança sozinho (conta→doc; doc→próximo). Não mandar SIM/NÃO/EDITAR.
- OCR fraco → `OCR_RETRY_*_SHORT` (só aquele anexo).
- `confirmando_dados_*` = legado / edição explícita.
