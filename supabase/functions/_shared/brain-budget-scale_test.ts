import {
  decideAnchorBudgetScale,
  formatAnchorScaleUpWhatsApp,
} from "./brain-budget-scale.ts";

Deno.test("escala sobe com CPL bom", () => {
  const r = decideAnchorBudgetScale({
    currentBudgetCents: 1000,
    maxBudgetCents: 50000,
    targetCplCents: 200,
    recentCplCents: 150,
    recentConversations: 10,
    recentSpendCents: 1500,
    minHoursBetweenScaleUps: 0,
  });
  if (r.action !== "scale_up") throw new Error(`expected scale_up got ${r.action}`);
  if (r.budgetCents <= 1000) throw new Error("budget deve subir");
});

Deno.test("escala desce com CPL ruim", () => {
  const r = decideAnchorBudgetScale({
    currentBudgetCents: 2000,
    maxBudgetCents: 50000,
    targetCplCents: 200,
    recentCplCents: 400,
    recentConversations: 8,
    recentSpendCents: 3200,
  });
  if (r.action !== "scale_down") throw new Error(`expected scale_down got ${r.action}`);
  if (r.budgetCents >= 2000) throw new Error("budget deve descer");
});

Deno.test("segura com poucos dados", () => {
  const r = decideAnchorBudgetScale({
    currentBudgetCents: 1000,
    maxBudgetCents: 50000,
    targetCplCents: 200,
    recentCplCents: 100,
    recentConversations: 1,
    recentSpendCents: 100,
  });
  if (r.action !== "hold") throw new Error(`expected hold got ${r.action}`);
});

Deno.test("CPL ok mas última subida recente — segura sem trava de 48h", () => {
  const r = decideAnchorBudgetScale({
    currentBudgetCents: 1000,
    maxBudgetCents: 50000,
    targetCplCents: 200,
    recentCplCents: 150,
    recentConversations: 10,
    recentSpendCents: 1500,
    lastScaleAtIso: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    minHoursBetweenScaleUps: 4,
  });
  if (r.action !== "hold") throw new Error(`expected hold got ${r.action}`);
});

Deno.test("CPL ruim mas última escala recente — segura (gap também no down)", () => {
  const r = decideAnchorBudgetScale({
    currentBudgetCents: 2000,
    maxBudgetCents: 50000,
    targetCplCents: 200,
    recentCplCents: 400,
    recentConversations: 8,
    recentSpendCents: 3200,
    lastScaleAtIso: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    minHoursBetweenScaleUps: 4,
  });
  if (r.action !== "hold") throw new Error(`expected hold got ${r.action}`);
});

Deno.test("após intervalo curto — sobe de novo (não precisa esperar 48h)", () => {
  const r = decideAnchorBudgetScale({
    currentBudgetCents: 1000,
    maxBudgetCents: 50000,
    targetCplCents: 200,
    recentCplCents: 150,
    recentConversations: 10,
    recentSpendCents: 1500,
    lastScaleAtIso: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
    minHoursBetweenScaleUps: 4,
  });
  if (r.action !== "scale_up") throw new Error(`expected scale_up got ${r.action}`);
});

Deno.test("degrau 20% sobe exatamente 20%", () => {
  const r = decideAnchorBudgetScale({
    currentBudgetCents: 1000,
    maxBudgetCents: 50000,
    targetCplCents: 200,
    recentCplCents: 100,
    recentConversations: 10,
    recentSpendCents: 1000,
    stepPct: 20,
    minHoursBetweenScaleUps: 0,
  });
  if (r.action !== "scale_up") throw new Error(`expected scale_up got ${r.action}`);
  if (r.budgetCents !== 1200) throw new Error(`expected 1200 got ${r.budgetCents}`);
});

Deno.test("degrau 30% desce 30%", () => {
  const r = decideAnchorBudgetScale({
    currentBudgetCents: 1000,
    maxBudgetCents: 50000,
    targetCplCents: 200,
    recentCplCents: 400,
    recentConversations: 8,
    recentSpendCents: 3200,
    stepPct: 30,
  });
  if (r.action !== "scale_down") throw new Error(`expected scale_down got ${r.action}`);
  if (r.budgetCents !== 700) throw new Error(`expected 700 got ${r.budgetCents}`);
});

Deno.test("mensagem WhatsApp de subida tem carteira e CPL", () => {
  const msg = formatAnchorScaleUpWhatsApp({
    fromCents: 1000,
    toCents: 1150,
    stepPct: 15,
    walletLiquidCents: 21987,
    cplCents: 180,
    conversations: 12,
    spendCents: 2160,
    targetCplCents: 200,
    reason: "CPL R$ 1,80 ≤ alvo R$ 2,00 — sobe 15%",
  });
  if (!msg.includes("*Cérebro · Budget subiu!*")) throw new Error("titulo");
  if (!msg.includes("*Campanha:*")) throw new Error("label campanha");
  if (!msg.includes("*Carteira")) throw new Error("carteira");
  if (!msg.includes("Custo por lead")) throw new Error("cpl");
  if (!msg.includes("Por que subiu")) throw new Error("motivo");
});
