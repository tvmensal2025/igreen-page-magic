// Pure state machine for the conversational phase of the bot.
// NO I/O, NO LLM — just (currentStep, intent, customer) → { nextStep, action }.
// 100% testable.
//
// FONTE ÚNICA (unificação webhooks): este arquivo é a fonte canônica.
// `whapi-webhook/handlers/conversational/state-machine.ts` e
// `evolution-webhook/handlers/conversational/state-machine.ts` apenas
// reexportam daqui (eram cópias idênticas — confirmado por diff = 0).

export type ConversationalStep =
  | "welcome"
  | "menu_inicial"
  | "qualificacao"
  | "pos_video"
  | "checkin_pos_video"
  | "pitch_conexao_club"
  | "duvidas_pos_club"
  | "aguardando_humano";

export const CONVERSATIONAL_STEPS: ReadonlySet<string> = new Set<ConversationalStep>([
  "welcome",
  "menu_inicial",
  "qualificacao",
  "pos_video",
  "checkin_pos_video",
  "pitch_conexao_club",
  "duvidas_pos_club",
  "aguardando_humano",
]);

export type Intent =
  | "saudacao"
  | "quer_cadastrar"
  | "quer_humano"
  | "tem_duvida"
  | "ja_assistiu_video"
  | "nao_quer"
  | "afirmacao"
  | "negacao"
  | "outro";

export type Action =
  | { type: "send_template"; step_key: string; template_key: string }
  | { type: "send_video"; slot_key: string; followup_step?: string }
  | { type: "noop" };

export interface Transition {
  nextStep: string;
  action: Action;
}

// The bridge to the cadastro flow. Anything that should start cadastro
// returns this transition. Cadastro code (untouched) takes over from here.
const ENTER_CADASTRO: Transition = {
  nextStep: "aguardando_conta",
  action: { type: "send_template", step_key: "checkin_pos_video", template_key: "pedir_conta" },
};

const HANDOFF: Transition = {
  nextStep: "aguardando_humano",
  action: { type: "send_template", step_key: "aguardando_humano", template_key: "avisado" },
};

export function decideTransition(
  currentStep: ConversationalStep,
  intent: Intent,
  // deno-lint-ignore no-explicit-any
  _customer: any = {},
): Transition {
  // Universal overrides — apply in any conversational step
  if (intent === "quer_cadastrar") return ENTER_CADASTRO;
  if (intent === "quer_humano") return HANDOFF;

  switch (currentStep) {
    case "welcome":
      if (intent === "saudacao" || intent === "afirmacao")
        return { nextStep: "qualificacao", action: { type: "send_video", slot_key: "explainer", followup_step: "checkin_pos_video" } };
      return { nextStep: "welcome", action: { type: "send_template", step_key: "welcome", template_key: "saudacao" } };

    case "menu_inicial":
      if (intent === "afirmacao")
        return { nextStep: "qualificacao", action: { type: "send_video", slot_key: "explainer", followup_step: "checkin_pos_video" } };
      if (intent === "negacao" || intent === "nao_quer")
        return { nextStep: "menu_inicial", action: { type: "send_template", step_key: "menu_inicial", template_key: "reforco" } };
      return { nextStep: "menu_inicial", action: { type: "send_template", step_key: "menu_inicial", template_key: "reforco" } };

    case "qualificacao":
      if (intent === "ja_assistiu_video")
        return { nextStep: "checkin_pos_video", action: { type: "send_template", step_key: "checkin_pos_video", template_key: "reforco_checkin" } };
      return { nextStep: "qualificacao", action: { type: "send_template", step_key: "qualificacao", template_key: "pergunta_conta" } };

    case "pos_video":
    case "checkin_pos_video":
      if (intent === "afirmacao")
        return { nextStep: "pitch_conexao_club", action: { type: "send_video", slot_key: "club", followup_step: "duvidas_pos_club" } };
      if (intent === "tem_duvida")
        return { nextStep: "duvidas_pos_club", action: { type: "send_template", step_key: "duvidas_pos_club", template_key: "pode_perguntar" } };
      if (intent === "negacao" || intent === "nao_quer")
        return { nextStep: "checkin_pos_video", action: { type: "send_template", step_key: "checkin_pos_video", template_key: "reforco_checkin" } };
      return { nextStep: "checkin_pos_video", action: { type: "send_template", step_key: "checkin_pos_video", template_key: "reforco_checkin" } };

    case "pitch_conexao_club":
      // After the club video plays, we always move into doubts. Action is noop
      // because the video itself is sent by the previous transition.
      return { nextStep: "duvidas_pos_club", action: { type: "send_template", step_key: "duvidas_pos_club", template_key: "pode_perguntar" } };

    case "duvidas_pos_club":
      if (intent === "afirmacao") return ENTER_CADASTRO;
      if (intent === "negacao" || intent === "nao_quer")
        return { nextStep: "duvidas_pos_club", action: { type: "send_template", step_key: "duvidas_pos_club", template_key: "rumo_cadastro" } };
      // tem_duvida / outro → keep listening
      return { nextStep: "duvidas_pos_club", action: { type: "send_template", step_key: "duvidas_pos_club", template_key: "pode_perguntar" } };

    case "aguardando_humano":
      // Human takes over; bot stays silent unless the user clearly asks to restart.
      return { nextStep: "aguardando_humano", action: { type: "noop" } };

    default:
      return { nextStep: currentStep, action: { type: "send_template", step_key: "fallback", template_key: "nao_entendi" } };
  }
}
