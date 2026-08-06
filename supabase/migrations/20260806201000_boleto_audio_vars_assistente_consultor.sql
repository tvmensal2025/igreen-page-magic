-- Áudio boleto: IA e consultor por variável (não Sofia/Rafael fixos).
-- Abertura “Olá, Nome! Tudo bem?” continua prefixada no código.
UPDATE public.boleto_notify_config
SET
  audio_script = $audio$Aqui é {{assistente}}, assistente virtual {{posse_consultor}}, e estou passando com uma notícia importante: o seu boleto de energia deste mês já está disponível!

A iGreen realiza o envio oficial do boleto, mas o jeito mais seguro, rápido e completo de acompanhar tudo é pelo aplicativo iGreen Club.

Acesse o app para conferir a sua fatura, a data de vencimento e aproveitar descontos especiais em farmácias, restaurantes, cinemas e milhares de estabelecimentos parceiros.

E olha que notícia incrível: hoje, já somos mais de oitocentas mil pessoas economizando com a iGreen! É muita gente economizando junto!

Se precisar de ajuda, é só chamar {{chamar_consultor}}. Até mais!$audio$,
  updated_at = now()
WHERE id = 'global';
