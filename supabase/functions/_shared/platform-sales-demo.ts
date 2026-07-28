/**
 * Demo pós-venda no Zap — só alvos de platform_sales (consultor piloto).
 * Botões Whapi ≤3; menu 1–8 = texto numerado.
 * Textos vêm de pos_venda_default_media (cliente), não inventados.
 * Nome no áudio = prenome do consultor (alvo); sem nome usável → Maria.
 */
import { applyOutboundTemplateVars } from "./outbound-template-vars.ts";
import { safeFirstNameForAddress } from "./customer-display-name.ts";

export const PS_DEMO_CLIENT_NAME = "Maria";
export const PS_DEMO_NAME_SOURCE = "manual";

export const PS_DEMO_BTN_YES = "ps_demo_yes";
export const PS_DEMO_BTN_LATER = "ps_demo_later";
export const PS_DEMO_BTN_CLOSE = "ps_demo_close";
export const PS_DEMO_BTN_REOPEN = "ps_demo_reopen";

export type PsDemoFlowState = "idle" | "cta_sent" | "menu" | "done";

export const PS_DEMO_MENU = [
  { n: 1, stage: "aprovado", label: "Aprovado", emoji: "✅" },
  { n: 2, stage: "d30", label: "30 dias", emoji: "📅" },
  { n: 3, stage: "d60", label: "60 dias", emoji: "📅" },
  { n: 4, stage: "d90", label: "90 dias", emoji: "📅" },
  { n: 5, stage: "d120", label: "120 dias", emoji: "🗓️" },
  { n: 6, stage: "d150", label: "150 dias", emoji: "🗓️" },
  { n: 7, stage: "d180", label: "180 dias", emoji: "🗓️" },
  { n: 8, stage: "d210", label: "210 dias", emoji: "🏁" },
] as const;

export type PsDemoStage = (typeof PS_DEMO_MENU)[number]["stage"];

export const PS_DEMO_CTA_PROMPT =
  "🎧 *Quer ouvir as mensagens enviadas ao cliente até o fechamento?*\n\n" +
  "São os *roteiros reais* do pós-venda — do *aprovado* até *210 dias*.";

export function buildPsDemoMenuText(): string {
  const lines = PS_DEMO_MENU.map((m) => `*${m.n}.* ${m.emoji} *${m.label}*`);
  return (
    `📋 *Qual mensagem o cliente recebe?*\n\n` +
    `${lines.join("\n")}\n\n` +
    `_Digite o número de *1* a *8*._\n` +
    `_Ou digite *sair* para encerrar._`
  );
}

export function stageForDemoNumber(n: number): PsDemoStage | null {
  const hit = PS_DEMO_MENU.find((m) => m.n === n);
  return hit ? hit.stage : null;
}

/**
 * Nome falado no áudio da demo: prenome do consultor (alvo), senão Maria.
 * Limpa sufixos tipo "( Igreen )" / " - Franquia".
 */
export function resolvePsDemoClientName(raw: string | null | undefined): string {
  let cleaned = String(raw || "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s*[-–—|/].*$/, " ")
    .replace(/\s+/g, " ")
    .trim();
  cleaned = cleaned
    .replace(/\b(consultora?|franquia|acionista|lead|crm|vivo|bni)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const first = safeFirstNameForAddress(cleaned, PS_DEMO_NAME_SOURCE);
  return first || PS_DEMO_CLIENT_NAME;
}

export function composePsDemoClientMessage(
  rawTemplate: string,
  opts?: { customerName?: string | null; now?: Date },
): string {
  const name = resolvePsDemoClientName(opts?.customerName);
  return applyOutboundTemplateVars(rawTemplate, {
    customerName: name,
    nameSource: PS_DEMO_NAME_SOURCE,
    now: opts?.now ?? new Date(),
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

  // Menu / reabrir ANTES de "ver" genérico (senão "Ver menu" vira yes).
  if (
    /^(menu|abrir(\s+menu)?|ver\s+menu|de novo|novamente)\b/i.test(raw) ||
    raw === "abrir menu"
  ) {
    return { kind: "reopen" };
  }
  if (/^(encerrar|fechar|parar|sair|obrigad)/i.test(raw)) {
    return { kind: "close" };
  }
  if (/^(sim|quero|quero ouvir|ouvir|ver mensagens|1\s*sim)\b/i.test(raw)) {
    return { kind: "yes" };
  }
  if (/^(nao|não|agora nao|agora não|depois)\b/i.test(raw)) {
    return { kind: "later" };
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
  "👍 *Combinado.*\n\nQuando quiser ouvir as mensagens do *cliente*, toque no botão ou digite *Sim*.";

export const PS_DEMO_CLOSE_TEXT =
  "✅ *Pronto!*\n\nSe quiser ouvir de novo, toque em *Abrir menu* ou digite *menu*.";

export const PS_DEMO_FALLBACK_CTA =
  "🤔 *Não entendi.*\n\nToque em *Sim, quero ouvir* ou *Agora não* (ou digite *1* / *2*).";

export const PS_DEMO_FALLBACK_MENU =
  "🤔 *Não entendi.*\n\nDigite um número de *1* a *8* para ouvir a mensagem daquele momento.";

export type PsDemoOutbound =
  | { type: "text"; text: string }
  | { type: "buttons"; text: string; buttons: Array<{ id: string; title: string }> }
  | { type: "image"; url: string }
  | { type: "audio"; url: string };

/** Consultor dono do cache TTS da demo (Rafael / Whapi SuperAdmin). */
export const PS_DEMO_TTS_CONSULTANT_ID = "0c2711ad-4836-41e6-afba-edd94f698ae3";

/**
 * Pós-venda canônico no Zap = imagem + áudio stitch (intro+saudação+corpo),
 * sem bolha de texto e sem TTS do roteiro inteiro.
 * O roteiro de `pos_venda_default_media.message_text` alimenta o stitch;
 * `stageText` só entra se o pacote de mídia falhar por completo.
 */
export function buildPsDemoOutbounds(
  resolved: ReturnType<typeof resolvePsDemoAction>,
  opts?: {
    stageText?: string | null;
    imageUrl?: string | null;
    audioUrl?: string | null;
    /** true = imagem/áudio já entram na sequência; sem fallback de texto do roteiro */
    mediaPackOk?: boolean;
  },
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
    const outs: PsDemoOutbound[] = [];
    const imageUrl = String(opts?.imageUrl || "").trim();
    const audioUrl = String(opts?.audioUrl || "").trim();
    if (imageUrl) outs.push({ type: "image", url: imageUrl });
    if (audioUrl) outs.push({ type: "audio", url: audioUrl });

    // Sem mídia utilizável → fallback texto do roteiro (último recurso).
    if (!opts?.mediaPackOk) {
      const body =
        String(opts?.stageText || "").trim() ||
        "⚠️ Não consegui montar o áudio agora. Digite outro número de *1* a *8*.";
      outs.push({ type: "text", text: body });
    }

    // Ordem canônica: imagem → áudio → *mesmo* menu do 1º envio (sem botões extras).
    outs.push({ type: "text", text: buildPsDemoMenuText() });
    return outs;
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
