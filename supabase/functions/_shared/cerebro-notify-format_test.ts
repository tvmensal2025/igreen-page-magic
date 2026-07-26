import {
  formatCerebroActivateWhatsApp,
  formatCerebroSeedWhatsApp,
  formatCerebroSlotsWhatsApp,
  formatCerebroWastePauseWhatsApp,
} from "./cerebro-notify-format.ts";

Deno.test("formatCerebroSeedWhatsApp — rica e com cidade", () => {
  const msg = formatCerebroSeedWhatsApp({
    cityName: "Araxá",
    budgetCents: 517,
    protocol: "2026-0042",
  });
  if (!msg.includes("Araxá")) throw new Error("missing city");
  if (!msg.includes("Cérebro")) throw new Error("missing brand");
  if (!msg.includes("fila")) throw new Error("missing queue status");
  if (!msg.includes("2026-0042")) throw new Error("missing protocol");
});

Deno.test("formatCerebroSlotsWhatsApp — lista exploradoras", () => {
  const msg = formatCerebroSlotsWhatsApp({
    explorers: ["Uberaba", "Araguari"],
    anchorBudgetCents: 2500,
    explorerBudgetCents: 1000,
    ageMin: 30,
    activated: ["Araguari"],
    paused: ["Betim"],
  });
  if (!msg.includes("Uberaba")) throw new Error("missing explorer");
  if (!msg.includes("Betim")) throw new Error("missing paused");
  if (!msg.includes("Mapa de praças")) throw new Error("missing title");
});

Deno.test("formatCerebroActivateWhatsApp — ativa", () => {
  const msg = formatCerebroActivateWhatsApp({
    cityName: "Patos de Minas",
    budgetCents: 1000,
  });
  if (!msg.includes("Patos de Minas")) throw new Error("missing city");
  if (!msg.includes("no ar")) throw new Error("missing CTA tone");
});

Deno.test("formatCerebroWastePauseWhatsApp — trava e português", () => {
  const msg = formatCerebroWastePauseWhatsApp({
    campaignName: "SEDE-UDI-50km · [CONS-rafael-ferreira] CEMIG · iGreen — Sede",
    reason: "AUTO_PERF_PAUSE: Waste guard: R$ 10.11 sem conversa Meta (2d) — só reativa no Play",
    spendCents: 1011,
    conversations: 0,
    clicks: 3,
    rule: "zero_conv",
  });
  if (!msg.includes("Play")) throw new Error("missing play hint");
  if (!msg.includes("proteger seu saldo")) throw new Error("missing pt-BR tone");
  if (!msg.includes("Conversas no WhatsApp")) throw new Error("missing pt label");
  if (msg.includes("AUTO_PERF")) throw new Error("should not expose AUTO_PERF");
  if (msg.includes("`zero_conv`")) throw new Error("should not expose raw rule code");
  if (!msg.includes("R$")) throw new Error("missing spend");
  if (!msg.includes("SEDE-UDI-50km")) throw new Error("missing campaign name");
});

Deno.test("formatCerebroWastePauseSms — curto e pt-BR", async () => {
  const { formatCerebroWastePauseSms } = await import("./cerebro-notify-format.ts");
  const sms = formatCerebroWastePauseSms({
    campaignName: "SEDE-UDI-50km · [CONS-rafael] iGreen",
    spendCents: 1011,
  });
  if (sms.length > 160) throw new Error(`sms too long: ${sms.length}`);
  if (!sms.includes("pausei")) throw new Error("missing pt verb");
  if (sms.toLowerCase().includes("ctwa")) throw new Error("no ctwa jargon in sms");
  if (sms.includes("apos")) throw new Error("missing accent: após not apos");
});
