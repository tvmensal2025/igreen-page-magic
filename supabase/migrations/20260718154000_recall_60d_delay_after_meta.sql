-- Encurta espera após Meta/ads até o 1º recall WA (1080h ≈ 45d → 336h ≈ 14d).
-- Timeline aproximada após Dia 10: +1d Meta + ~14d ads + ~14d = ~30d até RECALL_60D.
-- Não liga automação.

UPDATE public.cadence_stage_config
SET delay_hours = 336, updated_at = now()
WHERE consultant_id IS NULL AND stage::text = 'RECALL_60D';

UPDATE public.cadence_stage_config
SET message_text = E'Olá, *{{nome}}*! 👋\n\nAqui é o *Rafael Ferreira Dias*, da *iGreen*.\n\nFaz cerca de *1 mês* que falamos sobre *economia na conta de luz*.\n\n✅ Sua *análise continua disponível* — e agora fica ainda mais simples: iniciamos só com o *valor médio* da conta. Sem foto, sem burocracia.\n\n{{frase_disponibilidade}}\n\n*Em qual faixa está sua conta hoje?*\n\n_Para não receber mais contatos, responda SAIR._',
    updated_at = now()
WHERE consultant_id IS NULL AND stage::text = 'RECALL_60D';

UPDATE public.automation_toggles
SET description = 'Marco longo ~30d após Dia 10: WA análise → SMS se silêncio → ligação (delay 14d após Meta/ads).'
WHERE key = 'cadence_recall_60d';
