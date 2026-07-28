# AGENTS — pós-venda auto-progress

Domínio: `#pos-venda` · mapa id `pos-venda`.

## Fatos
- Marcos **D30…D210** + retentativa 60d
- Canal: Whapi primeiro (`resolveChannelForCustomerWithFailover`)
- **NÃO** consulta `bot_global_enabled` — só `pos_venda_auto_messages` + `pos_venda_manual=true`
- Idempotência: `customer_auto_message_log`
- Pacote Zap: **imagem + áudio** (`forbidText`); áudio preferencialmente de `pos_venda_prepared_audio` (prep cron)

## Evidência prod
1114 em `espera` · log: 18 `pv_reprovado` + poucos D* enviados

## NÃO
Misturar com `sale_stage_*` · truncar UI em D120 · hardcode consultor UUID nos seeds
