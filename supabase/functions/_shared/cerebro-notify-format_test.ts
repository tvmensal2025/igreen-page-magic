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

Deno.test("formatCerebroWastePauseWhatsApp — trava AUTO_PERF", () => {
  const msg = formatCerebroWastePauseWhatsApp({
    campaignName: "MG-ROT-betim",
    reason: "AUTO_PERF_PAUSE: ≥R$10/0 conv",
    spendCents: 1250,
    conversations: 0,
    clicks: 3,
    rule: "zero_conv",
  });
  if (!msg.includes("Play")) throw new Error("missing play hint");
  if (!msg.includes("zero_conv")) throw new Error("missing rule");
  if (!msg.includes("R$")) throw new Error("missing spend");
});
