/**
 * Demo pós-venda no Zap — só alvos de platform_sales (consultor piloto).
 * Botões Whapi ≤3; menu 1–8 = texto numerado.
 * Textos vêm de pos_venda_default_media (cliente), não inventados.
 */
import { applyOutboundTemplateVars } from "./outbound-template-vars.ts";

export const PS_DEMO_CLIENT_NAME = "Maria";
export const PS_DEMO_NAME_SOURCE = "manual";

export const PS_DEMO_BTN_YES = "ps_demo_yes";
export const PS_DEMO_BTN_LATER = "ps_demo_later";
export const PS_DEMO_BTN_CLOSE = "ps_demo_close";
export const PS_DEMO_BTN_REOPEN = "ps_demo_reopen";

export type PsDemoFlowState = "idle" | "cta_sent" | "menu" | "done";

export const PS_DEMO_MENU = [
  { n: 1, stage: "aprovado", label: "Aprovado" },
  { n: 2, stage: "d30", label: "30 dias" },
  { n: 3, stage: "d60", label: "60 dias" },
  { n: 4, stage: "d90", label: "90 dias" },
  { n: 5, stage: "d120", label: "120 dias" },
  { n: 6, stage: "d150", label: "150 dias" },
  { n: 7, stage: "d180", label: "180 dias" },
  { n: 8, stage: "d210", label: "210 dias" },
] as const;

export type PsDemoStage = (typeof PS_DEMO_MENU)[number]["stage"];

export const PS_DEMO_CTA_PROMPT =
  "Quer ouvir as mensagens enviadas ao *cliente* até o fechamento?\n\nSão os roteiros reais do pós-venda (aprovado → 210 dias).";

export function buildPsDemoMenuText(): string {
  const lines = PS_DEMO_MENU.map((m) => `*${m.n}.* ${m.label}`);
  return (
    `Quer ouvir qual mensagem o *cliente* recebe?\n\n` +
    `${lines.join("\n")}\n\n` +
    `_Digite o número (1 a 8)._`
  );
}

export function stageForDemoNumber(n: number): PsDemoStage | null {
  const hit = PS_DEMO_MENU.find((m) => m.n === n);
  return hit ? hit.stage : null;
}

export function composePsDemoClientMessage(
  rawTemplate: string,
  now: Date = new Date(),
): string {
  return applyOutboundTemplateVars(rawTemplate, {
    customerName: PS_DEMO_CLIENT_NAME,
    nameSource: PS_DEMO_NAME_SOURCE,
    now,
  }).trim();
}

export type PsDemoIntent =
  | { kind: "yes" }
  | { kind: "later" }
  | { kind: "close" }
  | { kind: "reopen" }
  | { kind: "number"; n: number }
  | { kind: "unknown" };

export function parsePsDemoIntent(
  messageText: string | null | undefined,
  buttonId: string | null | undefined,
): PsDemoIntent {
  const bid = String(buttonId || "").trim().toLowerCase();
  if (bid === PS_DEMO_BTN_YES || bid === "ps_demo_yes") return { kind: "yes" };
  if (bid === PS_DEMO_BTN_LATER || bid === "ps_demo_later") return { kind: "later" };
  if (bid === PS_DEMO_BTN_CLOSE || bid === "ps_demo_close") return { kind: "close" };
  if (bid === PS_DEMO_BTN_REOPEN || bid === "ps_demo_reopen") return { kind: "reopen" };

  const raw = String(messageText || "").trim().toLowerCase();
  if (!raw) return { kind: "unknown" };

  // Dígito puro 1–8 (ou *1.* / 1.)
  const numHit = raw.match(/^[*_~]*(\d{1,2})[*_~.!\s]*$/);
  if (numHit) {
    const n = Number(numHit[1]);
    if (n >= 1 && n <= 8) return { kind: "number", n };
  }

  if (/^(sim|quero|quero ouvir|ouvir|ver|ver mensagens|1\s*sim)\b/i.test(raw)) {
    return { kind: "yes" };
  }
  if (/^(nao|não|agora nao|agora não|depois|2)\b/i.test(raw)) {
    return { kind: "later" };
  }
  if (/^(encerrar|fechar|parar|sair|obrigad)/i.test(raw)) {
    return { kind: "close" };
  }
  if (/^(menu|abrir|de novo|novamente)/i.test(raw)) {
    return { kind: "reopen" };
  }

  return { kind: "unknown" };
}

/** Resolve intenção no contexto do estado (evita 1=Sim vs 1=Aprovado). */
export function resolvePsDemoAction(
  state: PsDemoFlowState,
  intent: PsDemoIntent,
): 
  | { action: "ignore" }
  | { action: "send_menu"; nextState: "menu" }
  | { action: "send_later"; nextState: "cta_sent" }
  | { action: "send_stage"; stage: PsDemoStage; nextState: "menu" }
  | { action: "send_close"; nextState: "done" }
  | { action: "fallback_menu"; nextState: "menu" }
  | { action: "fallback_cta"; nextState: "cta_sent" } {
  if (state === "idle") return { action: "ignore" };

  if (state === "cta_sent") {
    if (intent.kind === "yes") return { action: "send_menu", nextState: "menu" };
    if (intent.kind === "later") return { action: "send_later", nextState: "cta_sent" };
    if (intent.kind === "number" && intent.n === 1) return { action: "send_menu", nextState: "menu" };
    if (intent.kind === "number" && intent.n === 2) return { action: "send_later", nextState: "cta_sent" };
    if (intent.kind === "reopen") return { action: "send_menu", nextState: "menu" };
    return { action: "fallback_cta", nextState: "cta_sent" };
  }

  if (state === "menu") {
    if (intent.kind === "number") {
      const stage = stageForDemoNumber(intent.n);
      if (stage) return { action: "send_stage", stage, nextState: "menu" };
    }
    if (intent.kind === "close") return { action: "send_close", nextState: "done" };
    if (intent.kind === "yes" || intent.kind === "reopen") {
      return { action: "send_menu", nextState: "menu" };
    }
    return { action: "fallback_menu", nextState: "menu" };
  }

  // done — nunca silêncio: oferece reabrir
  if (intent.kind === "reopen" || intent.kind === "yes") {
    return { action: "send_menu", nextState: "menu" };
  }
  if (intent.kind === "number") {
    const stage = stageForDemoNumber(intent.n);
    if (stage) return { action: "send_stage", stage, nextState: "menu" };
  }
  return { action: "send_close", nextState: "done" };
}

export const PS_DEMO_LATER_TEXT =
  "Combinado. Quando quiser ouvir as mensagens do *cliente*, toque no botão ou digite *Sim*.";

export const PS_DEMO_CLOSE_TEXT =
  "Pronto! Se quiser ouvir de novo, toque em *Abrir menu* ou digite *menu*.";

export const PS_DEMO_FALLBACK_CTA =
  "Não entendi. Toque em *Sim, quero ouvir* ou *Agora não* (ou digite *1* / *2*).";

export const PS_DEMO_FALLBACK_MENU =
  "Não entendi. Digite um número de *1* a *8* para ouvir a mensagem daquele momento.";

export type PsDemoOutbound =
  | { type: "text"; text: string }
  | { type: "buttons"; text: string; buttons: Array<{ id: string; title: string }> };

/** Monta a sequência de envios para uma ação (nunca vazia, exceto ignore). */
export function buildPsDemoOutbounds(
  resolved: ReturnType<typeof resolvePsDemoAction>,
  stageText?: string | null,
): PsDemoOutbound[] {
  if (resolved.action === "ignore") return [];

  if (resolved.action === "send_menu") {
    return [{ type: "text", text: buildPsDemoMenuText() }];
  }

  if (resolved.action === "send_later") {
    return [
      {
        type: "buttons",
        text: PS_DEMO_LATER_TEXT,
        buttons: [{ id: PS_DEMO_BTN_YES, title: "Ver mensagens" }],
      },
    ];
  }

  if (resolved.action === "send_stage") {
    const body = String(stageText || "").trim() || "(Roteiro indisponível no momento.)";
    return [
      { type: "text", text: body },
      { type: "text", text: buildPsDemoMenuText() },
      {
        type: "buttons",
        text: "Quer encerrar a demonstração?",
        buttons: [
          { id: PS_DEMO_BTN_CLOSE, title: "Encerrar" },
          { id: PS_DEMO_BTN_REOPEN, title: "Ver menu" },
        ],
      },
    ];
  }

  if (resolved.action === "send_close") {
    return [
      {
        type: "buttons",
        text: PS_DEMO_CLOSE_TEXT,
        buttons: [{ id: PS_DEMO_BTN_REOPEN, title: "Abrir menu" }],
      },
    ];
  }

  if (resolved.action === "fallback_cta") {
    return [
      {
        type: "buttons",
        text: PS_DEMO_FALLBACK_CTA,
        buttons: [
          { id: PS_DEMO_BTN_YES, title: "Sim, quero ouvir" },
          { id: PS_DEMO_BTN_LATER, title: "Agora não" },
        ],
      },
    ];
  }

  // fallback_menu
  return [
    { type: "text", text: `${PS_DEMO_FALLBACK_MENU}\n\n${buildPsDemoMenuText()}` },
  ];
}

export function buildPsDemoCtaButtonsOutbound(): PsDemoOutbound {
  return {
    type: "buttons",
    text: PS_DEMO_CTA_PROMPT,
    buttons: [
      { id: PS_DEMO_BTN_YES, title: "Sim, quero ouvir" },
      { id: PS_DEMO_BTN_LATER, title: "Agora não" },
    ],
  };
}

/** Digits E.164 BR (55…) para match de alvo. */
export function psDemoPhoneDigits(raw: string): string {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  return d;
}
