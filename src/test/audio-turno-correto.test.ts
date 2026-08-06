/**
 * Áudio personalizado não pode vazar de um lead para outro.
 *
 * Item da auditoria que estava listado como "não comprovado": áudio ligado ao
 * turno errado. Três coisas precisam valer ao mesmo tempo:
 *
 *  1. a chave de cache do stitch inclui o NOME normalizado — sem isso o áudio
 *     "Olá, João" seria reaproveitado para a Maria;
 *  2. o módulo de stitch não guarda estado mutável entre requisições (o mesmo
 *     defeito das variáveis globais já corrigidas no conversacional);
 *  3. o nome usado no warm vem do escopo do turno (`captureUpdates`), não de
 *     um `customer` relido depois que outro turno já mexeu na linha.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const FN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../supabase/functions");
const STITCH = readFileSync(path.join(FN, "_shared/wa-audio-stitch.ts"), "utf8");
const CHANNELS = ["whapi-webhook", "evolution-webhook"] as const;

describe("cache de áudio personalizado", () => {
  it("chaveia o stitch pelo nome normalizado", () => {
    expect(STITCH).toContain("const nameNorm = normalizeCallName(display)");
    expect(STITCH).toMatch(/buildStitchSlotCandidates\(spec,\s*gender,\s*nameNorm\)/);
  });

  it("chaveia a intro pelo nome normalizado", () => {
    // O nome é parâmetro obrigatório e entra em toda variante de slug — não há
    // caminho que gere um slug de intro sem o nome dentro.
    const assinatura = STITCH.slice(
      STITCH.indexOf("export function buildIntroSlotCandidates("),
      STITCH.indexOf("export function buildStitchSlotCandidates("),
    );
    expect(assinatura).toMatch(/nameNorm: string,\s*\)/);
    const slugs = assinatura.match(/`intro:[^`]*`/g) || [];
    expect(slugs.length).toBeGreaterThan(0);
    for (const slug of slugs) expect(slug).toContain("${nameNorm}");
  });

  it("chaveia o slug canônico do stitch pelo nome", () => {
    expect(STITCH).toMatch(/`stitch:\$\{spec\.baseSlot\}:[^`]*\$\{nameNorm\}`/);
  });

  it("não personaliza quando a fonte do nome não é confiável", () => {
    // resolveWaDisplayName devolve vazio → probe/warm desistem antes de montar.
    expect(STITCH).toContain("resolveWaDisplayName(opts.customerName, opts.nameSource)");
    expect(STITCH).toMatch(/if \(!display\) return/);
  });

  it("não guarda estado mutável de módulo", () => {
    // Só coluna 0 interessa: `let` indentado é variável local de função, que
    // morre com a chamada e não atravessa requisições.
    const mutaveis = STITCH.split("\n").filter((l) =>
      /^(let|var)\s+\w+/.test(l) || /^const \w+ = new (Map|Set|WeakMap)\b/.test(l)
    );
    expect(mutaveis).toEqual([]);
  });
});

describe.each(CHANNELS)("warm de áudio usa o nome do turno (%s)", (channel) => {
  const src = readFileSync(path.join(FN, channel, "handlers/conversational/index.ts"), "utf8");
  const bloco = src.slice(
    src.indexOf("if (captureUpdates.name && consultantId)"),
    src.indexOf("// Pré-aquece A3"),
  );

  it("passa captureUpdates.name, não o customer relido", () => {
    expect(bloco.length).toBeGreaterThan(0);
    expect(bloco).toContain("customerName: captureUpdates.name");
    expect(bloco).toContain("nameSource: captureUpdates.name_source");
  });

  it("mantém o turno isolado por AsyncLocalStorage", () => {
    expect(src).toContain("AsyncLocalStorage");
    expect(src).toContain("_turnStorage");
  });
});
