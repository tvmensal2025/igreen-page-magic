-- Tour passo 3: reforça uso de número de anúncio + risco de ban no chip pessoal.
UPDATE public.tour_steps SET
  title = 'Conecte um número de anúncio',
  body = E'Sem WhatsApp conectado, você não recebe nem responde contatos pela plataforma.

Use um número de anúncio: um chip dedicado só para esta operação (leads e campanhas).

Como conectar:
1. Abra WhatsApp no menu
2. Entre em Configuração
3. Leia o QR Code com o celular do número escolhido

[[ALERT]]
CUIDADO — não use o número atual
Conectar o WhatsApp pessoal (ou o número que você já usa no dia a dia) aumenta muito o risco de banimento. Anúncios e volume de mensagens podem fazer o WhatsApp bloquear o chip. Prefira um número novo, exclusivo para anúncios.
[[/ALERT]]',
  updated_at = now()
WHERE order_index = 3 AND is_active = true;
