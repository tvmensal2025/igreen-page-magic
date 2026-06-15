// Teste de PARIDADE entre o helper do front (qrPhrase.ts) e o espelho em Deno
// (supabase/functions/_shared/qr-phrase.ts).
//
// POR QUE ESTE TESTE EXISTE
// -------------------------
// A frase do QR/link é montada em DOIS lugares com lógica que PRECISA ser idêntica:
//   • FRONT (`PartnerQrCode`) — exibe/prevê a frase no card do QR;
//   • RUNTIME (`qr-redirect`, Deno) — monta o `?text=` do wa.me no link curto.
// Se os dois divergirem, o consultor vê uma frase no painel e o lead recebe outra.
// Este teste roda os MESMOS casos nos dois módulos e exige resultado igual, então
// qualquer drift entre eles aparece como teste vermelho.

import { describe, it, expect } from "vitest";
import * as front from "../qrPhrase";
import * as deno from "../../../../../supabase/functions/_shared/qr-phrase";

// Casos representativos: sem frase, frase curta com/sem keyword, frase longa
// (o bug do "Valdenice me indicou..."), acento/maiúscula, e vazios.
const CASOS: { qrPhrase: string | null; keyword: string | null }[] = [
  { qrPhrase: null, keyword: "Valdenice" },
  { qrPhrase: "", keyword: "" },
  { qrPhrase: "Vim pela Valdenice, quero reduzir minha conta de luz", keyword: "Valdenice" },
  { qrPhrase: "Quero economizar na conta de luz", keyword: "Valdenice" },
  { qrPhrase: "Indicação do João aqui, quero economizar", keyword: "joao" },
  {
    qrPhrase:
      "Olá, a Valdenice me indicou você porque quero economizar na minha conta de luz e queria saber mais.",
    keyword: "Valdenice",
  },
  { qrPhrase: "Quero muito reduzir o valor da minha conta de energia agora", keyword: "promocao-especial-black-friday-energia" },
];

describe("qr-phrase — paridade front ↔ Deno", () => {
  it("QR_PHRASE_MAX é igual nos dois módulos", () => {
    expect(deno.QR_PHRASE_MAX).toBe(front.QR_PHRASE_MAX);
  });

  it("resolveQrMessage produz saída idêntica em todos os casos", () => {
    for (const c of CASOS) {
      const f = front.resolveQrMessage(c.qrPhrase, c.keyword);
      const d = deno.resolveQrMessage(c.qrPhrase, c.keyword);
      expect(d).toBe(f);
    }
  });

  it("buildDefaultQrPhrase produz saída idêntica", () => {
    for (const kw of ["Valdenice", "", "  Solar  SP  ", null, undefined]) {
      expect(deno.buildDefaultQrPhrase(kw)).toBe(front.buildDefaultQrPhrase(kw));
    }
  });

  it("containsKeyword concorda nos dois módulos", () => {
    const pares: [string, string][] = [
      ["Oi, sou a Valdência!", "valdencia"],
      ["conta de luz", "solar"],
      ["qualquer coisa", ""],
    ];
    for (const [phrase, kw] of pares) {
      expect(deno.containsKeyword(phrase, kw)).toBe(front.containsKeyword(phrase, kw));
    }
  });
});
