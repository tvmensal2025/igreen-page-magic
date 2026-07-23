import {
  shortCampaignName,
  formatCampaignApprovedMessage,
  formatRodizioMetricsMessage,
} from "./rodizio-metrics-format.ts";

Deno.test("shortCampaignName limpa CONS e MG-ROT", () => {
  const a = shortCampaignName("MG-ROT-uberaba · [CONS-rafael-ferreira] CEMIG");
  if (a !== "Uberaba") throw new Error(`got ${a}`);
  const b = shortCampaignName("remarketing-uberlandia · [CONS-rafael-ferreira]");
  if (!/uberl[aâ]ndia/i.test(b)) throw new Error(`got ${b}`);
  if (/CONS/i.test(b)) throw new Error(`CONS vazou: ${b}`);
});

Deno.test("aprovada exclusiva + intervalo 3h + checklist", () => {
  const text = formatCampaignApprovedMessage({
    campaignName: "MG-ROT-betim · [CONS-x] CEMIG",
    partnerName: "Maria Souza",
    partnerIgreenId: "123",
    position: 1,
    totalPositions: 1,
    dailyBudgetCents: 517,
    cities: ["Betim"],
    intervalMinutes: 180,
    quietStartHour: 21,
    quietEndHour: 9,
  });
  if (!text.includes("exclusiva")) throw new Error("faltou exclusiva");
  if (!text.includes("3 horas")) throw new Error("faltou 3 horas");
  if (!text.includes("*Betim*")) throw new Error(`nome ruim:\n${text}`);
  if (!text.includes("O que você vai receber")) throw new Error("faltou checklist");
  if (!text.includes("21h–09h")) throw new Error("faltou quiet hours");
  if (text.includes("`")) throw new Error("backtick no WhatsApp");
});

Deno.test("métricas enriquecidas 3h", () => {
  const text = formatRodizioMetricsMessage({
    campaignName: "MG-ROT-uberaba · [CONS-x]",
    campaignStatus: "active",
    spendTodayCents: 250,
    reachToday: 100,
    impressionsToday: 1000,
    clicksToday: 40,
    conversationsStartedToday: 8,
    spend7dCents: 1000,
    conversations7d: 20,
    clicks7d: 80,
    leadsCrmToday: 4,
    leadsCrm7d: 12,
    partnerPosition: 1,
    partnerPoolSize: 1,
    partnerLeadsTotal: 3,
    partnerNewLeadsSinceLast: 1,
    nowLabel: "23/07 04:00",
    intervalMinutes: 180,
    dailyBudgetCents: 517,
    trackingProtocol: "2026-0099",
    cities: ["Uberaba"],
    partnerName: "João",
    quietStartHour: 21,
    quietEndHour: 9,
  });
  if (/1º.*de 1/.test(text)) throw new Error("ainda mostra 1º de 1");
  if (!text.includes("exclusiva")) throw new Error("faltou exclusiva");
  if (!text.includes("3 horas")) throw new Error("faltou 3 horas");
  if (!text.includes("CTR")) throw new Error("faltou CTR");
  if (!text.includes("Uso do orçamento")) throw new Error("faltou uso orçamento");
  if (!text.includes("2026-0099")) throw new Error("faltou protocolo");
  if (!text.includes("Olá, João")) throw new Error("faltou saudação");
});
