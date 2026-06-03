/** Expand a spintax string like "{oi|olá|e aí} tudo {bem|certo}?" picking one random branch per group. Nesting supported. */
export function expandSpintax(input: string): string {
  if (!input) return "";
  let s = input;
  // Repeatedly resolve innermost {a|b|c} until none left
  const re = /\{([^{}]+)\}/;
  let guard = 0;
  while (re.test(s) && guard++ < 50) {
    s = s.replace(re, (_m, inner: string) => {
      const parts = inner.split("|");
      if (parts.length <= 1) return inner; // keep as-is
      return parts[Math.floor(Math.random() * parts.length)];
    });
  }
  return s;
}

/** Replace {nome}, {primeiro_nome}, {valor_conta}, {cidade}, {consultor}, {saudacao}. */
export function applyVars(
  template: string,
  ctx: { name?: string; bill?: number; city?: string; consultant?: string },
): string {
  if (!template) return "";
  const first = (ctx.name || "").trim().split(/\s+/)[0] || "";
  const hour = new Date().getHours();
  const saudacao = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
  const bill = typeof ctx.bill === "number"
    ? ctx.bill.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
    : "";
  return template
    .replace(/\{nome\}/gi, ctx.name || "")
    .replace(/\{primeiro_nome\}/gi, first)
    .replace(/\{valor_conta\}/gi, bill)
    .replace(/\{cidade\}/gi, ctx.city || "")
    .replace(/\{consultor\}/gi, ctx.consultant || "")
    .replace(/\{saudacao\}/gi, saudacao);
}

export function renderFinal(
  template: string,
  ctx: Parameters<typeof applyVars>[1],
): string {
  return expandSpintax(applyVars(template, ctx));
}
