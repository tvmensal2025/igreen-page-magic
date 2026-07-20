/**
 * Gera SQL que sincroniza gatilhos/texto do seed para TODOS os bot_flow_qa
 * com o mesmo intent_name (Sofia, públicos e cópias por consultor).
 *
 * Uso: deno run -A scripts/sync-qa-shortcuts-all-flows.ts
 */
import {
  OBJECTION_SHORTCUTS,
  formatIntentName,
} from "../src/lib/objectionShortcuts.ts";

const esc = (s: string) => s.replace(/'/g, "''");

let sql = `-- Sync FAQ atalhos: seed limpo → todos os fluxos (por intent_name)
-- Gerado por scripts/sync-qa-shortcuts-all-flows.ts

CREATE OR REPLACE FUNCTION public.sync_objection_shortcut_all(
  _intent_name text,
  _text_response text,
  _triggers text[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _qa record;
  _phrase text;
  _n int := 0;
BEGIN
  FOR _qa IN
    SELECT id FROM bot_flow_qa
    WHERE intent_name = _intent_name
      AND coalesce(is_opening, false) = false
      AND coalesce(is_closing, false) = false
  LOOP
    UPDATE bot_flow_qa
    SET text_response = NULLIF(_text_response, ''),
        updated_at = now()
    WHERE id = _qa.id;

    DELETE FROM bot_flow_qa_triggers WHERE qa_id = _qa.id;

    FOREACH _phrase IN ARRAY _triggers LOOP
      IF length(trim(_phrase)) > 0 THEN
        INSERT INTO bot_flow_qa_triggers (qa_id, phrase) VALUES (_qa.id, trim(_phrase));
      END IF;
    END LOOP;

    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'ensure_qa_media_slots') THEN
      PERFORM public.ensure_qa_media_slots(_qa.id);
    END IF;

    _n := _n + 1;
  END LOOP;

  RETURN _n;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_objection_shortcut_all(text, text, text[]) TO authenticated;

`;

for (const s of OBJECTION_SHORTCUTS) {
  const intent = formatIntentName(s);
  const triggers = "ARRAY[" + s.triggers.map((t) => `'${esc(t)}'`).join(",") + "]::text[]";
  sql += `SELECT public.sync_objection_shortcut_all('${esc(intent)}', '${esc(s.text)}', ${triggers});\n`;
}

// Também garante os 50 no fluxo Sofia (cria se faltar)
const sofia = "59f53614-196c-4b6f-a029-59fadca78bd7";
sql += `\n-- Garante existência no fluxo Sofia\n`;
for (const s of OBJECTION_SHORTCUTS) {
  const intent = formatIntentName(s);
  const triggers = "ARRAY[" + s.triggers.map((t) => `'${esc(t)}'`).join(",") + "]::text[]";
  sql += `SELECT public.refresh_objection_shortcut('${sofia}', '${esc(intent)}', '${esc(s.text)}', ${triggers});\n`;
}

const totalTriggers = OBJECTION_SHORTCUTS.reduce((n, s) => n + s.triggers.length, 0);
sql += `\n-- Limpa gatilhos genéricos órfãos restantes (palavra única perigosa)\n`;
sql += `DELETE FROM bot_flow_qa_triggers
WHERE lower(trim(phrase)) IN (
  'fidelidade','multa','golpe','furada','depois','sair','data','ap','cobertura','obra',
  'ativar','link','conta','taxa','solar','pagar','seguro','prazo','cancelar','pix','ceo',
  'dono','aqui','moro','cidade','ligar','explica','humano','mentira','scam','aneel','cnpj',
  'lgpd','anos','placa','juros','caro','sede','sócio','socio','enel','cemig','light','spc',
  'cosip','apagão','apagao','piramide','pirâmide','amarrado','desconfio','duvido','estranho',
  'suspeito','oculta','surpresa','pegadinha','adesão','adesao','mensalidade'
);\n`;

sql += `\n-- Total seed: ${OBJECTION_SHORTCUTS.length} intents, ${totalTriggers} gatilhos\n`;

const out = "supabase/migrations/20260720170000_sync_qa_shortcuts_all_flows.sql";
await Deno.writeTextFile(out, sql);
console.log(`written ${out}: ${OBJECTION_SHORTCUTS.length} intents, ${totalTriggers} triggers`);
