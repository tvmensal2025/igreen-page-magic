-- FAQ cobertura: cidade do anúncio ≠ cidade do lead (vizinha / fora).
-- Amplia triggers + texto educado (distribuidora/CEMIG, sem cobrar resposta).

SELECT public.refresh_objection_shortcut(
  '59f53614-196c-4b6f-a029-59fadca78bd7',
  'Técnico · Funciona na minha cidade',
  E'Tranquilo, {{nome}}! 😊\n\nO anúncio pode citar uma cidade, mas a *iGreen* atende pela *distribuidora* da sua conta (em Minas, por exemplo, *CEMIG*) — *cidade vizinha também entra*.\n\nNo cadastro a gente confirma na hora se sua região é elegível. É rapidinho 🌱⚡',
  ARRAY[
    'atende na minha cidade','atende minha região','tem cobertura aqui','funciona na minha cidade','atendem na minha cidade',
    'não sou de','nao sou de','não moro em','nao moro em','não sou daqui','nao sou daqui',
    'moro em outra','outra cidade','cidade vizinha','fora da cidade',
    'não atende minha','nao atende minha','sou de outra cidade',
    'não sou de uberlândia','nao sou de uberlandia','não moro em uberlândia','nao moro em uberlandia',
    'só pra uberlândia','so para uberlandia','apenas uberlândia','apenas uberlandia',
    'moro em araguari','sou de araguari','moro em uberaba','sou de uberaba',
    'moro em patrocínio','sou de patrocinio','moro em ituiutaba','sou de ituiutaba',
    'aqui em araguari','aqui em uberaba','moro em araxa','sou de araxa'
  ]::text[]
);
