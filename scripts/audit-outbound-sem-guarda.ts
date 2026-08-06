/**
 * Levantamento: inserts de outbound em `conversations` sem confirmação de envio.
 *
 * Para cada `message_direction: "outbound"` nos arquivos do fluxo oficial,
 * olha a janela anterior (mesmo bloco) e classifica:
 *   - GUARDED: existe checagem do retorno do send antes de gravar
 *     (`=== false`, `okSend`, `dispatchMediaOnce`, `commitOutboundTurn`,
 *     `isSendConfirmed`, `sendConfirmed`, `deliveryStatus`);
 *   - INBOUND-ONLY / NO-SEND: o insert não está colado num send (ex.: registro
 *     de mensagem do lead, agendamento) — fora do escopo;
 *   - UNGUARDED: send próximo sem checagem — candidato a correção.
 *
 * Uso: deno run -A scripts/audit-outbound-sem-guarda.ts
 */

const FILES = [
  "supabase/functions/whapi-webhook/index.ts",
  "supabase/functions/whapi-webhook/handlers/bot-flow.ts",
  "supabase/functions/whapi-webhook/handlers/conversational/index.ts",
  "supabase/functions/evolution-webhook/index.ts",
  "supabase/functions/evolution-webhook/handlers/bot-flow.ts",
  "supabase/functions/evolution-webhook/handlers/conversational/index.ts",
];

const SEND_RE = /(?:await|=>)\s*(?:ctx\.)?(?:sender\.|realSender\.)?(sendText|sendMedia|sendButtons|sendOptions|sendAudio|sendVoice|sendImage|sendVideo|sendDocument)\s*\(/;
// `recordHistory` é callback do `commitOutboundTurn`: por construção só roda
// depois do envio confirmado, mesmo o `send:` aparecendo poucas linhas acima.
const GUARD_RE = /(===?\s*false|!==?\s*false|okSend|okQa|\bok\w*\s*=|dispatchMediaOnce|commitOutboundTurn|isSendConfirmed|sendConfirmed|deliveryStatus|recordHistory|\.sent\b|\.ok\b|sentOk|sendResult|_sendOk|if\s*\(\s*!\s*\w*(ok|sent|disp))/i;

let total = 0, unguarded = 0;
for (const file of FILES) {
  const src = await Deno.readTextFile(file);
  const lines = src.split("\n");
  const hits: { line: number; verdict: string; sendLine: string; snippet: string[] }[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/message_direction:\s*["']outbound["']/.test(lines[i])) continue;
    total++;
    // Janela para trás: até 45 linhas ou até sair do bloco (linha em branco dupla).
    const from = Math.max(0, i - 45);
    const win = lines.slice(from, i + 1);
    const winText = win.join("\n");
    const sendIdx = win.map((l, j) => (SEND_RE.test(l) && !/console\.(warn|error|log)/.test(l) ? j : -1)).filter((j) => j >= 0);
    if (sendIdx.length === 0) {
      hits.push({ line: i + 1, verdict: "no-send-nearby", sendLine: "", snippet: [] });
      continue;
    }
    const lastSend = sendIdx[sendIdx.length - 1];
    const between = win.slice(lastSend, win.length).join("\n");
    const guarded = GUARD_RE.test(between);
    const snippet = win.slice(lastSend, win.length)
      .map((l, j) => `${from + lastSend + j + 1}| ${l.slice(0, 120)}`);
    hits.push({
      line: i + 1,
      verdict: guarded ? "guarded" : "UNGUARDED",
      sendLine: win[lastSend].trim().slice(0, 110),
      snippet: snippet.length > 16 ? [...snippet.slice(0, 4), `     … ${snippet.length - 8} linhas …`, ...snippet.slice(-4)] : snippet,
    });
    if (!guarded) unguarded++;
  }
  const un = hits.filter((h) => h.verdict === "UNGUARDED");
  console.log(`\n${file} — ${hits.length} inserts outbound, ${un.length} sem guarda`);
  for (const h of hits) {
    if (h.verdict === "UNGUARDED") {
      console.log(`  ── L${h.line} ──`);
      for (const l of h.snippet) console.log(`     ${l}`);
    }
  }
}
console.log(`\nTOTAL: ${total} inserts, ${unguarded} sem guarda perto de um send`);
