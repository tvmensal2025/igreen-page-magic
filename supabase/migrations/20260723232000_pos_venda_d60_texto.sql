-- Texto padrão pós-venda d60: Club + iGreen Seguros + indicação.

UPDATE public.pos_venda_default_media
SET
  message_text = $txt$Olá, {{nome}}.

Tudo bem?

Hoje eu não vim falar apenas da sua economia na conta de energia.

Eu vim lembrar que a iGreen é muito mais do que isso.

Se faz alguns dias que você não abre o aplicativo iGreen Club, vale a pena entrar novamente.

É por lá que você acompanha o andamento do seu benefício, consulta suas faturas, acessa seus benefícios e conhece as novidades que vão sendo liberadas para os clientes.

Além disso, você encontra descontos exclusivos em milhares de parceiros por todo o Brasil, com cupons em grandes marcas e vantagens que podem ajudar você a economizar no dia a dia.

E uma novidade que está fazendo muito sucesso é o iGreen Seguros.

Agora você também pode fazer a cotação do seguro do seu carro, moto ou caminhão com pagamento mensal, sem fidelidade e com contratação totalmente digital.

O projeto conta com o Gusttavo Lima como embaixador oficial e é respaldado pela BP Seguradora, regulamentada pela SUSEP.

E tem mais.

Se você conhece alguém que também gostaria de economizar na conta de energia, indique essa pessoa.

Além de ajudar um amigo ou familiar a pagar menos todos os meses, você também pode acumular cashback pelas indicações válidas, conforme as regras do programa.

Nossa equipe cuida de todo o atendimento, do começo ao fim.

Obrigado pela confiança.

Estamos muito felizes por ter você fazendo parte da iGreen.

E lembre-se: conte sempre com a gente. Estamos aqui para acompanhar você em cada etapa da sua jornada.$txt$,
  updated_at = now()
WHERE stage = 'd60';

UPDATE public.stage_auto_messages sam
SET message_text = (
  SELECT message_text FROM public.pos_venda_default_media WHERE stage = 'd60' LIMIT 1
)
FROM public.kanban_stages ks
WHERE sam.stage_id = ks.id
  AND ks.stage_scope = 'pos_venda'
  AND ks.stage_key = 'pv_d60'
  AND ks.consultant_id = '0c2711ad-4836-41e6-afba-edd94f698ae3';
