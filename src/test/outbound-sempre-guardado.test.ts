/**
 * Nenhum ponto do fluxo oficial grava outbound sem confirmar o envio.
 *
 * Auditoria 2026-08: `sendText`/`sendMedia`/`sendButtons` podem devolver `false`
 * SEM lançar exceção — guard de pausa humana (`wrapSenderWithLivePauseGuard`),
 * destino inválido (`whapi_dest_unresolved`) ou erro HTTP do canal. Os handlers
 * gravavam a linha em `conversations` de qualquer jeito, então o consultor via
 * no CRM uma conversa que o lead nunca recebeu.
 *
 * Este teste é a rede de contenção: reproduz o levantamento de
 * `scripts/audit-outbound-sem-guarda.ts` e falha se alguém adicionar um insert
 * de outbound novo sem checar o retorno do send.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const FN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../supabase/functions");

const FILES = [
  "whapi-webhook/index.ts",
  "whapi-webhook/handlers/bot-flow.ts",
  "whapi-webhook/handlers/conversational/index.ts",
  "evolution-webhook/index.ts",
  "evolution-webhook/handlers/bot-flow.ts",
  "evolution-webhook/handlers/conversational/index.ts",
];

const SEND_RE =
  /(?:await|=>)\s*(?:ctx\.)?(?:sender\.|realSender\.)?(sendText|sendMedia|sendButtons|sendOptions|sendAudio|sendVoice|sendImage|sendVideo|sendDocument)\s*\(/;

// `recordHistory` é callback do `commitOutboundTurn`: só roda com envio
// confirmado, mesmo o `send:` aparecendo poucas linhas acima.
const GUARD_RE =
  /(===?\s*false|!==?\s*false|okSend|okQa|\bok\w*\s*=|dispatchMediaOnce|commitOutboundTurn|isSendConfirmed|sendConfirmed|deliveryStatus|recordHistory|\.sent\b|\.ok\b|sentOk|sendResult|_sendOk|if\s*\(\s*!\s*\w*(ok|sent|disp))/i;

function pontosSemGuarda(src: string): number[] {
  const lines = src.split("\n");
  const out: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/message_direction:\s*["']outbound["']/.test(lines[i])) continue;
    const from = Math.max(0, i - 45);
    const win = lines.slice(from, i + 1);
    const sendIdx = win
      .map((l, j) => (SEND_RE.test(l) && !/console\.(warn|error|log)/.test(l) ? j : -1))
      .filter((j) => j >= 0);
    if (sendIdx.length === 0) continue; // insert que não segue um envio
    const depoisDoSend = win.slice(sendIdx[sendIdx.length - 1]).join("\n");
    if (!GUARD_RE.test(depoisDoSend)) out.push(i + 1);
  }
  return out;
}

describe.each(FILES)("outbound sempre guardado (%s)", (rel) => {
  const src = readFileSync(path.join(FN, rel), "utf8");

  it("todo insert de outbound colado num send checa o retorno", () => {
    expect(pontosSemGuarda(src)).toEqual([]);
  });
});

describe("helper de confirmação", () => {
  it("está importado onde os handlers gravam outbound", () => {
    for (const rel of FILES) {
      const src = readFileSync(path.join(FN, rel), "utf8");
      expect(src, rel).toMatch(/isSendConfirmed|commitOutboundTurn/);
    }
  });
});
