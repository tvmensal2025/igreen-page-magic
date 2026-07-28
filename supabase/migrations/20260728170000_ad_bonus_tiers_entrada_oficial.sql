-- Bônus de entrada Ads: tetos oficiais Conexão Green
-- Alto 60% · Médio 40% · Sem bônus 0%
-- Faixas por pessoas: src/data/entradaBonusTiers.ts

INSERT INTO public.ad_bonus_tiers (tier, label, percent) VALUES
  ('alto', 'Bônus alto', 60),
  ('medio', 'Bônus médio', 40),
  ('sem_bonus', 'Sem bônus', 0)
ON CONFLICT (tier) DO UPDATE
SET
  label = EXCLUDED.label,
  percent = EXCLUDED.percent,
  updated_at = now();
