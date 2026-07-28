-- Faixas e distribuidoras editáveis por tier (tabela comercial muda mês a mês).
-- percent = teto exibido no Ads; faixas/distribuidoras = detalhe da tabela oficial.

ALTER TABLE public.ad_bonus_tiers
  ADD COLUMN IF NOT EXISTS faixas jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS distribuidoras jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.ad_bonus_tiers.faixas IS
  'Faixas editáveis: [{minPessoas,maxPessoas|null,totalPct,imediatoPct,injecaoPct,label}]';
COMMENT ON COLUMN public.ad_bonus_tiers.distribuidoras IS
  'Distribuidoras do tier: [{ufs:[],label,nomeApi}] — remover quando sair da tabela.';

-- Seed Jul/2026 (arte comercial Conexão Green)
UPDATE public.ad_bonus_tiers SET
  percent = 60,
  label = 'Bônus alto',
  faixas = '[
    {"minPessoas":1,"maxPessoas":9,"totalPct":4,"imediatoPct":4,"injecaoPct":0,"label":"1–9 · padrão 4%"},
    {"minPessoas":10,"maxPessoas":39,"totalPct":20,"imediatoPct":10,"injecaoPct":10,"label":"10–39 · 20% (10+10)"},
    {"minPessoas":40,"maxPessoas":99,"totalPct":40,"imediatoPct":20,"injecaoPct":20,"label":"40–99 · 40% (20+20)"},
    {"minPessoas":100,"maxPessoas":199,"totalPct":50,"imediatoPct":30,"injecaoPct":20,"label":"100–199 · 50% (30+20)"},
    {"minPessoas":200,"maxPessoas":null,"totalPct":60,"imediatoPct":40,"injecaoPct":20,"label":"200+ · 60% (40+20)"}
  ]'::jsonb,
  distribuidoras = '[
    {"ufs":["AL"],"label":"Equatorial AL","nomeApi":"EQUATORIAL"},
    {"ufs":["BA"],"label":"Coelba","nomeApi":"COELBA"},
    {"ufs":["CE"],"label":"Enel CE","nomeApi":"ENEL"},
    {"ufs":["GO"],"label":"Equatorial GO","nomeApi":"EQUATORIAL"},
    {"ufs":["MG"],"label":"Cemig","nomeApi":"CEMIG-D"},
    {"ufs":["MS"],"label":"Energisa MS","nomeApi":"ENERGISA"},
    {"ufs":["MT"],"label":"Energisa MT","nomeApi":"ENERGISA"},
    {"ufs":["PE"],"label":"Neoenergia PE","nomeApi":"NEO ENERGIA"},
    {"ufs":["PI"],"label":"Equatorial PI","nomeApi":"EQUATORIAL"},
    {"ufs":["PR"],"label":"Copel","nomeApi":"COPEL"},
    {"ufs":["RJ","MG"],"label":"Energisa Minas Rio","nomeApi":"ENERGISA MINAS RIO"},
    {"ufs":["RN"],"label":"Cosern","nomeApi":"COSERN"},
    {"ufs":["SP"],"label":"CPFL","nomeApi":"CPFL"},
    {"ufs":["SP"],"label":"Energisa Sul-Sudeste","nomeApi":"ENERGISA SUL SUDESTE"}
  ]'::jsonb,
  updated_at = now()
WHERE tier = 'alto';

UPDATE public.ad_bonus_tiers SET
  percent = 40,
  label = 'Bônus médio',
  faixas = '[
    {"minPessoas":1,"maxPessoas":9,"totalPct":4,"imediatoPct":4,"injecaoPct":0,"label":"1–9 · padrão 4%"},
    {"minPessoas":10,"maxPessoas":39,"totalPct":20,"imediatoPct":10,"injecaoPct":10,"label":"10–39 · 20% (10+10)"},
    {"minPessoas":40,"maxPessoas":null,"totalPct":40,"imediatoPct":20,"injecaoPct":20,"label":"40+ · teto 40% (20+20)"}
  ]'::jsonb,
  distribuidoras = '[
    {"ufs":["PB"],"label":"Energisa PB","nomeApi":"ENERGISA PB"},
    {"ufs":["SP","MS"],"label":"Elektro","nomeApi":"ELEKTRO"},
    {"ufs":["TO"],"label":"Energisa TO","nomeApi":"ENERGISA TOCANTINS"},
    {"ufs":["RS"],"label":"RGE","nomeApi":"RGE"},
    {"ufs":["SC"],"label":"Celesc","nomeApi":"CELESC"}
  ]'::jsonb,
  updated_at = now()
WHERE tier = 'medio';

UPDATE public.ad_bonus_tiers SET
  percent = 0,
  label = 'Sem bônus',
  faixas = '[]'::jsonb,
  distribuidoras = '[]'::jsonb,
  updated_at = now()
WHERE tier = 'sem_bonus';
