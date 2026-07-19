-- Endurece gatilhos FAQ cobertura: remove fragmentos genéricos ("não sou de", "moro em", "aqui" solto).

SELECT public.refresh_objection_shortcut(
  '59f53614-196c-4b6f-a029-59fadca78bd7',
  'Técnico · Funciona na minha cidade',
  E'Tranquilo, {{nome}}! 😊\n\nO anúncio pode citar uma cidade, mas a *iGreen* atende pela *distribuidora* da sua conta (em Minas, por exemplo, *CEMIG*) — *cidade vizinha também entra*.\n\nNo cadastro a gente confirma na hora se sua região é elegível. É rapidinho 🌱⚡',
  ARRAY[
    'atende na minha cidade','atende minha região','tem cobertura aqui','tem cobertura na minha cidade',
    'funciona na minha cidade','atendem na minha cidade',
    'moro em outra cidade','sou de outra cidade','cidade vizinha','fora da cidade','fora da região',
    'não atende minha cidade','nao atende minha cidade',
    'não sou de uberlândia','nao sou de uberlandia','não moro em uberlândia','nao moro em uberlandia',
    'só pra uberlândia','so para uberlandia','apenas uberlândia','apenas uberlandia',
    'moro em araguari','sou de araguari','moro em uberaba','sou de uberaba',
    'moro em patrocínio','sou de patrocinio','moro em ituiutaba','sou de ituiutaba',
    'moro em araxa','sou de araxa',
    'aqui em araguari','aqui em uberaba','aqui em uberlândia','aqui em uberlandia'
  ]::text[]
);
