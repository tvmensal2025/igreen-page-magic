/**
 * Biblioteca de textos — Conversão Multicanal (Grupo A / B / C).
 *
 * Regras Whapi (obrigatórias):
 * - No máximo 3 botões por mensagem interativa (API corta o resto).
 * - Título do botão ≤ 25 caracteres.
 * - Fluxo começa captando o NOME (texto livre, sem botão).
 * - Só depois pergunta faixa da conta com até 3 botões.
 *
 * Áudio WhatsApp e ligação (voz Sofia):
 * - Sempre TTS Sofia (nunca “voz Rafael” no áudio).
 * - Abertura padrão: Sofia = atendente virtual de {{consultor}}, da iGreen Energia.
 *
 * Placeholders: {{nome}}, {{frase_disponibilidade}}, {{abertura_sofia}}
 */

import { mergeApprovedA2Audios } from "@/lib/multichannelApprovedAudios";
import { normalizeBrazilPhone } from "@/lib/phone";

/** replaceAll compatível com lib ES2020 do projeto. */
function tplReplace(text: string, needle: string, value: string): string {
  return text.split(needle).join(value);
}

/**
 * Abertura oficial — áudio WA (corpo fixo A2).
 * Concordância do consultor: {{do_da_consultor}} (Dados → gender).
 * Sem cargo "gestor" — o consultor pode ser qualquer nível (não só admin).
 * {{gestor_a}} ainda resolve (legado) → string vazia.
 * Gênero do lead (bem-vindo/bem-vinda) fica só nos corpos A2 M/F abaixo.
 */
export const SOFIA_OPENING =
  "Eu sou a {{assistente}}, assistente virtual {{do_da_consultor}} {{consultor}} da iGreen.";

/**
 * Ligação GRAVADA (MakeTTSCall / clip) — NÃO é conversa ao vivo.
 * Objetivo único: mandar a pessoa responder no WhatsApp.
 * Proibido: "você prefere", "explicar agora", "30 segundos", ramificações.
 */
export const RECORDED_CALL_WA_CTA =
  "Por favor, responda no WhatsApp do {{consultor}} que eu continuo o atendimento por lá.";

export function recordedCallBody(reason: string, opening = SOFIA_OPENING): string {
  return `${opening}\n\n${String(reason || "").trim()}\n\n${RECORDED_CALL_WA_CTA}`;
}

const A2_ASK_BILL =
  "Para eu te mostrar o quanto você pode economizar, me diga quanto você está gastando por mês na conta de luz.";

/** Corpo A2 — lead feminino (bem-vinda). */
export const A2_BODY_EXPLAIN_FEMININO = `Seja muito bem-vinda.

${SOFIA_OPENING}

${A2_ASK_BILL}`;

/** Corpo A2 — lead masculino (bem-vindo). */
export const A2_BODY_EXPLAIN_MASCULINO = `Seja muito bem-vindo.

${SOFIA_OPENING}

${A2_ASK_BILL}`;

/** Alias (prévia genérica / ferramentas) — usa {{bem_vindo}} do lead. */
export const A2_BODY_EXPLAIN = `Seja muito {{bem_vindo}}.

${SOFIA_OPENING}

${A2_ASK_BILL}`;

/** Cumprimento curto + abertura (para colar no início do roteiro). */
export function sofiaAudioLead(opts: { withName?: boolean } = {}): string {
  if (opts.withName !== false) {
    return `Olá, {{nome}}. ${SOFIA_OPENING}`;
  }
  return `Olá. ${SOFIA_OPENING}`;
}

export type CadenceChannel =
  | "whatsapp_text"
  | "whatsapp_buttons"
  | "whatsapp_audio"
  | "sms"
  | "call_script"
  | "system";

export type CadenceGroup = "A" | "B" | "C" | "theme" | "availability";

/** Destino especial do clique (espelha Transition.goto_special do fluxo). */
export type CadenceButtonGotoSpecial = "humano" | "cadastro" | "ai" | "repeat";

/** Botão Whapi — title máx. 25 chars (whapi-api.ts). */
export type CadenceButton = {
  id: string;
  title: string;
  /**
   * Destino no fluxo A (step_key estável). Sync resolve → goto_step_id UUID.
   * Só Grupo A / bot_flow_steps — Grupos B/C roteiam por id no motor.
   */
  goto_step_key?: string | null;
  /** Destino especial: humano, cadastro, ai, repeat. */
  goto_special?: CadenceButtonGotoSpecial | null;
};

export const WHAPI_MAX_BUTTONS = 3;
export const WHAPI_MAX_BUTTON_TITLE = 25;

/**
 * Corte de áudio Sofia — cada trecho é TTS + cache separado.
 * - fixed: texto estável → gera 1x e reutiliza (0 crédito nas próximas).
 * - name: frase com nome no padrão profissional “Olá, Nome.” (AudioStudio).
 *   Nunca TTS do nome sozinho — corta início/fim e perde qualidade.
 * - gendered: frase M/F (bem-vindo/bem-vinda) → no máx. 2 caches.
 * - with_name: legado — evitar.
 */
export type AudioSegmentKind = "fixed" | "name" | "gendered" | "with_name";

export type SpeechGender = "masculino" | "feminino";

export type AudioSegment = {
  id: string;
  kind: AudioSegmentKind;
  label: string;
  text: string;
  /** Mesmo id/texto entre templates → mesmo hash de cache. */
  reusable?: boolean;
  /**
   * Corpo específico de gênero (ex.: 2a bem-vindo vs bem-vinda).
   * Na geração TTS, só entra no áudio daquele gênero; o outro fica no outro MP3.
   */
  genderVariant?: SpeechGender;
};

/** Formas gramaticais para áudio/texto conforme gênero do lead. */
export function genderLexicon(gender: SpeechGender = "masculino") {
  if (gender === "feminino") {
    return {
      bem_vindo: "bem-vinda",
      o_a: "a",
      do_da: "da",
      ao_a: "à",
      querido_a: "querida",
    };
  }
  return {
    bem_vindo: "bem-vindo",
    o_a: "o",
    do_da: "do",
    ao_a: "ao",
    querido_a: "querido",
  };
}

/** Abertura oficial reutilizável em vários áudios/ligações. */
export const SEG_SOFIA_OPENING: AudioSegment = {
  id: "sofia_opening",
  kind: "fixed",
  label: "Abertura Sofia (fixo · cache)",
  text: SOFIA_OPENING,
  reusable: true,
};

/**
 * @deprecated Nunca usar em ligação nem WhatsApp novo — nome isolado soa amador.
 * Preferir SEG_NAME_GREET / SEG_CALL_NAME_GREET / SEG_NAME_NAO_SEGREDO / SEG_ENTAO_NOME.
 */
export const SEG_NAME_ONLY: AudioSegment = {
  id: "name_only",
  kind: "name",
  label: "(legado) Só o nome — NÃO usar",
  text: "{{nome}}.",
  reusable: true,
};

/** Legado: “Nome, não tem segredo.” — passo 3 usa SEG_ENTAO_NOME. */
export const SEG_NAME_NAO_SEGREDO: AudioSegment = {
  id: "name_nao_segredo",
  kind: "name",
  label: "Nome + não tem segredo (variável · cache por nome)",
  text: "{{nome}}, não tem segredo.",
  reusable: true,
};

/** Passo 3 / 3b / 4a: “Então, Nome.” — se não houver nome, o motor pula este corte. */
export const SEG_ENTAO_NOME: AudioSegment = {
  id: "entao_nome",
  kind: "name",
  label: "Então + nome (variável · cache por nome)",
  text: "Então, {{nome}}.",
  reusable: true,
};

/**
 * Padrão profissional — WhatsApp A2: “Olá, Nome! Tudo bem?”
 * Cache `intro:ola:ptbr4:{norm}`. Passo 3 e 4a usam SEG_ENTAO_NOME.
 */
export const SEG_NAME_GREET: AudioSegment = {
  id: "name_greet_ola",
  kind: "name",
  label: "Olá + nome + tudo bem? (profissional · cache por nome)",
  text: "Olá, {{nome}}! Tudo bem?",
  reusable: true,
};

/**
 * Ligação GRAVADA (PSTN) — sem “tudo bem?” (não há resposta ao vivo).
 * Só cumprimento + nome; o corpo manda ir ao WhatsApp.
 */
export const SEG_CALL_NAME_GREET: AudioSegment = {
  id: "call_name_greet",
  kind: "name",
  label: "Olá + nome (ligação gravada · sem pergunta)",
  text: "Olá, {{nome}}!",
  reusable: true,
};

/** @deprecated Ligações / cadências B. WhatsApp A2 usa SEG_NAME_GREET. */
export const SEG_OLA_LEAD: AudioSegment = {
  id: "a2_ola_lead",
  kind: "fixed",
  label: "1 · Olá (fixo · 1x no cache)",
  text: "Olá.",
  reusable: true,
};

/** Corte fixo do passo 3 — “Então” (1x no cache, sem nome). */
export const SEG_ENTAO_LEAD: AudioSegment = {
  id: "a3_entao_lead",
  kind: "fixed",
  label: "1 · Então (fixo · 1x no cache)",
  text: "Então.",
  reusable: true,
};

export const SEG_WELCOME_GENDERED: AudioSegment = {
  id: "welcome_gendered",
  kind: "gendered",
  label: "Boas-vindas M/F (cache)",
  text: "Seja muito {{bem_vindo}}.",
  reusable: true,
};

export function joinAudioSegmentTexts(segs: Pick<AudioSegment, "text">[]): string {
  return segs
    .map((s) => s.text.trim())
    .filter(Boolean)
    .join("\n\n");
}

/** Cortes usados num áudio final: compartilhados + o corpo do gênero. */
export function filterSegmentsForGender(
  segs: AudioSegment[],
  gender: SpeechGender,
): AudioSegment[] {
  return segs.filter((s) => !s.genderVariant || s.genderVariant === gender);
}

export function hasGenderAudioVariants(segs: AudioSegment[]): boolean {
  return segs.some((s) => !!s.genderVariant);
}

/** Chave em audioUrls / audioClipIds: `a2_…__feminino` | `a2_…__masculino`. */
export function cadenceAudioUrlKey(tplKey: string, gender?: SpeechGender | null): string {
  if (!gender) return tplKey;
  return `${tplKey}__${gender}`;
}

export function resolveCadenceAudioUrl(
  lib: { audioUrls: Record<string, string> },
  tplKey: string,
  gender?: SpeechGender | null,
): string | undefined {
  if (gender) {
    return (
      lib.audioUrls[cadenceAudioUrlKey(tplKey, gender)] ??
      lib.audioUrls[tplKey] ??
      undefined
    );
  }
  return lib.audioUrls[tplKey];
}

/**
 * Slots em `ai_media_library` que o motor do fluxo (Whapi) consulta ao emitir
 * o passo.
 *
 * A2/A3 NÃO espelham o MP3 completo da prévia (contém Maria/Rodrigo) — o motor
 * costura "Olá/Então, {nome real}." + corpo fixo em runtime. Só A5 (sem nome)
 * espelha o áudio estático no slot do fluxo.
 */
export function flowMediaSlotKeysForCadence(tplKey: string): string[] {
  switch (tplKey) {
    case "a2_audio_activate_name":
    case "a2_text_ask_bill_value":
      // Corpos M/F vão em __body_* no gerador; stitch em runtime.
      return [];
    case "a3_explain_with_buttons":
    case "a3_audio_explain":
    case "a3b_pedir_pergunta":
      // Nome + corpo: nunca espelhar MP3 completo da prévia (Maria/Rodrigo).
      return [];
    case "a5_audio_club_benefits":
    case "a5b_after_club_buttons":
      return ["a5_audio_club_benefits"];
    case "a6_ocr_retry":
      return ["a6_ocr_retry"];
    case "a7_ocr_retry":
      return ["a7_ocr_retry"];
    default:
      return tplKey ? [tplKey] : [];
  }
}

/** Kinds na ordem de envio WhatsApp (igual StepMediaPanel / Whapi). */
export type CadenceMediaOrderKind = "audio" | "image" | "video" | "text";

/**
 * Templates do Grupo A em canal WhatsApp (funil Sofia / bot_flow_steps) suportam
 * upload + ordem de arquivos. Escada A (`a_nudge_*`) e B/C usam cadence-tick
 * (texto/botões/1 mídia) — sem sequência multimodal.
 */
export function cadenceTemplateSupportsFileMedia(
  tpl: Pick<CadenceTemplate, "group" | "channel" | "key">,
): boolean {
  const key = String(tpl.key || "");
  // Escada de silêncio → só motor (cadence_stage_config), não Whapi multimodal
  if (key.startsWith("a_nudge_")) return false;
  return (
    tpl.group === "A" &&
    (tpl.channel === "whatsapp_text" ||
      tpl.channel === "whatsapp_buttons" ||
      tpl.channel === "whatsapp_audio")
  );
}

/**
 * Ordem inicial sugerida a partir do catálogo (`audioPlacement` / áudio pareado).
 * O consultor pode mudar nas setas; persiste em `consultants.flow_step_media_order`.
 */
export function defaultMediaOrderForCadenceTemplate(
  tpl: Pick<
    CadenceTemplate,
    "audioPlacement" | "pairedAudioKey" | "canGenerateAudio" | "channel"
  >,
): CadenceMediaOrderKind[] {
  if (tpl.audioPlacement === "after_text") {
    return ["text", "audio", "image", "video"];
  }
  if (
    tpl.audioPlacement === "before_text" ||
    !!tpl.pairedAudioKey ||
    !!tpl.canGenerateAudio ||
    tpl.channel === "whatsapp_audio"
  ) {
    return ["audio", "text", "image", "video"];
  }
  return ["text", "audio", "image", "video"];
}

/**
 * Keys para o StepMediaPanel carregar/exibir (inclui corpos de corte A2/A3).
 * O motor de envio continua usando stitch; o painel precisa ver os MP3 dos cortes.
 */
export function stepMediaLookupKeys(slotOrStepKey: string): string[] {
  const k = String(slotOrStepKey || "").trim();
  if (!k) return [];
  switch (k) {
    case "a2_audio_activate_name":
    case "a2_text_ask_bill_value":
      return [
        "a2_audio_activate_name",
        "a2_audio_activate_name__body_feminino",
        "a2_audio_activate_name__body_masculino",
        "a2_audio_activate_name__feminino",
        "a2_audio_activate_name__masculino",
      ];
    case "a3_explain_with_buttons":
    case "a3_audio_explain":
      return [
        "a3_explain_with_buttons",
        "a3_audio_explain",
        "a3_explain_with_buttons__body",
        "a3_audio_explain__body",
        "a3_explain_with_buttons__body_feminino",
        "a3_explain_with_buttons__body_masculino",
      ];
    case "a5_audio_club_benefits":
    case "a5b_after_club_buttons":
      return ["a5_audio_club_benefits", "a5b_after_club_buttons"];
    default:
      return [k];
  }
}

/** Passos Sofia que costuram nome em runtime (corpo fixo em __body_*). */
export function isSofiaStitchMediaSlot(slotOrStepKey: string): boolean {
  const k = String(slotOrStepKey || "");
  return (
    k === "a2_audio_activate_name" ||
    k === "a2_text_ask_bill_value" ||
    k === "a3_explain_with_buttons" ||
    k === "a3_audio_explain" ||
    k === "a3b_pedir_pergunta"
  );
}

/**
 * Passos com editor Sofia na aba Mídias.
 * - Perfis conhecidos (bill/explain/club)
 * - Ou qualquer passo com {{nome}} (padrão Sofia: variável + fixo)
 */
export type SofiaEditableProfile = "bill" | "explain" | "club" | "generic";

export function resolveSofiaStepProfile(
  slotOrStepKey: string,
  stepKeyExtra = "",
): SofiaEditableProfile | null {
  const k = `${slotOrStepKey || ""} ${stepKeyExtra || ""}`.toLowerCase();
  if (
    k.includes("a2_audio_activate_name") ||
    k.includes("a2_text_ask_bill")
  ) {
    return "bill";
  }
  if (k.includes("a3_explain") || k.includes("a3_audio")) {
    return "explain";
  }
  if (k.includes("a5_audio_club") || k.includes("a5b_after_club")) {
    return "club";
  }
  return null;
}

/** Detecta placeholder {{nome}} no texto do passo. */
export function messageHasSofiaNomeVar(messageText: string | null | undefined): boolean {
  return /\{\{\s*nome\s*\}\}/i.test(String(messageText || ""));
}

/**
 * Quando mostrar o editor Sofia:
 * perfil conhecido OU mensagem com {{nome}} (padrão em qualquer passo).
 */
export function isSofiaEditableStep(
  slotOrStepKey: string,
  stepKeyExtra = "",
  messageText?: string | null,
): boolean {
  if (resolveSofiaStepProfile(slotOrStepKey, stepKeyExtra) != null) return true;
  return messageHasSofiaNomeVar(messageText);
}

/** Slot alvo ao enviar áudio manual no painel (corpo fixo, não prévia com nome). */
export function sofiaUploadTargetSlot(slotOrStepKey: string, gender: SpeechGender = "feminino"): string {
  const k = String(slotOrStepKey || "");
  if (k === "a2_audio_activate_name" || k === "a2_text_ask_bill_value") {
    return cadenceBodyAudioUrlKey("a2_audio_activate_name", gender);
  }
  if (k === "a3_explain_with_buttons" || k === "a3_audio_explain") {
    return cadenceBodyAudioUrlKey("a3_explain_with_buttons");
  }
  if (k === "a5b_after_club_buttons" || k === "a5_audio_club_benefits") {
    return "a5_audio_club_benefits";
  }
  return k || slotOrStepKey;
}

export const SPEECH_GENDERS: SpeechGender[] = ["feminino", "masculino"];

/** Primeiro nome limpo (mesmo critério do AudioStudio). */
export function firstNameOnly(nome: string): string {
  return (nome || "Cliente").trim().split(/\s+/)[0]?.replace(/[.,;:!?]+$/g, "") || "Cliente";
}

/** Nomes masculinos que terminam em "a". */
const MASCULINE_ENDING_A = new Set(["luca", "nicola", "joshua", "noa", "toba", "juda"]);

/** Sufixos tipicamente femininos no BR (Sirlene, Marlene, Aline, Clarice…). */
const FEMININE_SUFFIXES = [
  "lene", "rene", "sene", "tene", "dene", "ene",
  "iane", "aine", "eine", "oine", "uine", "ine",
  "elle", "ette", "isse", "ice", "yse", "aise",
] as const;

const FEMININE_NAMES = new Set([
  "maria", "ana", "julia", "juliana", "fernanda", "patricia", "amanda", "bruna",
  "camila", "carla", "carolina", "claudia", "cristina", "daniela", "debora",
  "eduarda", "eliane", "fabiana", "flavia", "gabriela", "giovana", "giovanna",
  "helena", "isabela", "isabella", "jessica", "joana", "larissa", "leticia",
  "luciana", "luiza", "manuela", "marcela", "mariana", "marta", "monica",
  "natalia", "paula", "priscila", "rafaela", "renata", "roberta", "sandra",
  "sara", "sofia", "talita", "tatiana", "thais", "valeria", "vanessa", "vitoria",
  "alice", "beatriz", "bianca", "clara", "laura", "lorena", "luana", "nicole",
  "olivia", "rebeca", "sabrina", "adriana", "aline", "andreia", "angela",
  "aparecida", "barbara", "denise", "fatima", "marcia", "raquel", "regina",
  "sirlene", "marlene", "darlene", "arlene", "helene", "irene", "joyce", "joice",
  "jaqueline", "jackeline", "suelen", "sheila", "carmen", "viviane", "kelly",
]);

const MASCULINE_NAMES = new Set([
  "jose", "joao", "antonio", "francisco", "carlos", "paulo", "pedro", "lucas",
  "luiz", "marcos", "luis", "gabriel", "rafael", "daniel", "marcelo", "bruno",
  "eduardo", "felipe", "rodrigo", "andre", "fabio", "leonardo", "gustavo",
  "guilherme", "ricardo", "diego", "thiago", "tiago", "matheus", "mateus",
  "vinicius", "vitor", "victor", "alexandre", "anderson", "arthur", "artur",
  "bernardo", "caio", "david", "douglas", "fernando", "henrique", "igor",
  "jorge", "leandro", "miguel", "murilo", "nicolas", "renato", "roberto",
  "rogerio", "samuel", "sergio", "wellington", "wesley", "william", "yuri",
  "luca", "enzo", "heitor", "lorenzo", "davi", "benicio", "rene",
]);

function normalizeNameKey(raw: string): string {
  return (raw || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .split(/\s+/)[0]
    ?.replace(/[^a-z]/g, "") || "";
}

function hasFeminineSuffix(n: string): boolean {
  return FEMININE_SUFFIXES.some((sfx) => n.length > sfx.length && n.endsWith(sfx));
}

/**
 * Infere gênero para bem-vindo/bem-vinda (áudio A2 e textos).
 * Lista F → lista M → termina em "a" → sufixos F (-ene/-ine/…) → default M.
 */
export function inferSpeechGender(rawName: string | null | undefined): SpeechGender {
  const n = normalizeNameKey(String(rawName || ""));
  if (!n) return "masculino";
  if (FEMININE_NAMES.has(n)) return "feminino";
  if (MASCULINE_NAMES.has(n)) return "masculino";
  if (n.endsWith("a") && !MASCULINE_ENDING_A.has(n)) return "feminino";
  if (hasFeminineSuffix(n)) return "feminino";
  return "masculino";
}

/** Slot de corpo fixo (sem nome) no ai_media_library / audioUrls. */
export function cadenceBodyAudioUrlKey(
  tplKey: string,
  gender?: SpeechGender | null,
): string {
  if (gender) return `${tplKey}__body_${gender}`;
  return `${tplKey}__body`;
}

export type CadenceTemplate = {
  key: string;
  group: CadenceGroup;
  channel: CadenceChannel;
  title: string;
  timing: string;
  canGenerateAudio: boolean;
  maxChars?: number;
  theme?: string;
  requiresApproval?: string;
  notes?: string;
  body: string;
  /**
   * Cortes para TTS Sofia. Se presente, o painel edita/aprova por bloco
   * e gera concatenando MP3 (fixos do cache).
   */
  audioSegments?: AudioSegment[];
  /**
   * Áudio parceiro deste texto/botões.
   * Ex.: 2b → pairedAudioKey = a2_audio_activate_name.
   */
  pairedAudioKey?: string;
  /**
   * Ordem na prévia/envio: texto → áudio → botões (`after_text`)
   * ou áudio → texto → botões (`before_text`, padrão legado).
   */
  audioPlacement?: "before_text" | "after_text";
  /** Não listar no painel (chave legada / alias de URL). */
  hiddenInPanel?: boolean;
  /** Até 3. Ausente/vazio = mensagem só texto (ex.: pedir nome). */
  buttons?: CadenceButton[];
  /**
   * Toque de conteúdo ligado a outro (ex.: erro OCR → pedido de foto).
   * Não cria nó no grafo; sync grava no fallback do passo pai.
   */
  linkedToStepKey?: string;
};

/** Toques de retry OCR → passo pai no fluxo (capture_*). */
export const OCR_RETRY_PARENT: Record<
  string,
  { parentKey: string; stepType: "capture_conta" | "capture_documento" }
> = {
  a6_ocr_retry: { parentKey: "a6_ask_bill_photo", stepType: "capture_conta" },
  a7_ocr_retry: { parentKey: "a7_ask_document", stepType: "capture_documento" },
};

/**
 * Mensagens auxiliares do código (após portal rejeitar dígitos).
 * Não criam nó no funil — sync grava em fallback do a10.
 * Ao cliente: sempre "código" (nunca "OTP").
 */
export const CODIGO_CONFIRM_KEYS = [
  "a10_codigo_confirm_ask",
  "a10_codigo_confirm_sim",
  "a10_codigo_confirm_nao",
] as const;

export const CODIGO_CONFIRM_PARENT_KEY = "a10_portal_otp_facial";

export const CODIGO_CONFIRM_BUTTONS: CadenceButton[] = [
  { id: "otp_confirm_sim", title: "✅ Sim, é esse" },
  { id: "otp_confirm_nao", title: "❌ Não, vou digitar" },
];

/** Botões padrão de faixa (sempre 3). */
export const BILL_RANGE_BUTTONS: CadenceButton[] = [
  { id: "bill_low", title: "Até R$300" },
  { id: "bill_mid", title: "R$300 a R$700" },
  { id: "bill_high", title: "Acima de R$700" },
];

export const BILL_OR_PHOTO_BUTTONS: CadenceButton[] = [
  { id: "bill_value", title: "Informar valor" },
  { id: "send_photo", title: "Enviar foto" },
  { id: "call_me", title: "Pode me ligar" },
];

export const NEXT_ACTION_BUTTONS: CadenceButton[] = [
  { id: "send_photo", title: "Enviar foto" },
  { id: "call_me", title: "Pode me ligar" },
  { id: "stop", title: "Encerrar" },
];

export const ANALYZE_OR_CALL_BUTTONS: CadenceButton[] = [
  { id: "analyze", title: "Quero analisar" },
  { id: "call_me", title: "Pode me ligar" },
  { id: "send_photo", title: "Enviar conta" },
];

/** Após explicação: clube / ativar / tirar dúvida (máx. 3 Whapi). */
export const AFTER_EXPLAIN_BUTTONS: CadenceButton[] = [
  {
    id: "more_benefits",
    title: "Saber mais benefício",
    goto_step_key: "a5b_after_club_buttons",
  },
  {
    id: "activate",
    title: "Ativar benefício",
    goto_step_key: "a6_ask_bill_photo",
  },
  {
    id: "duvida",
    title: "Tenho dúvida",
    goto_step_key: "a3b_pedir_pergunta",
  },
];

/** Após áudio do clube: ativar / dúvida / humano (máx. 3). */
export const AFTER_CLUB_BUTTONS: CadenceButton[] = [
  {
    id: "register",
    title: "Ativar benefício",
    goto_step_key: "a6_ask_bill_photo",
  },
  {
    id: "duvida",
    title: "Tenho dúvida",
    goto_step_key: "a3b_pedir_pergunta",
  },
  { id: "human", title: "Falar com humano", goto_special: "humano" },
];

/** Botões iniciais de decisão (antes da explicação). */
export const ACTIVATE_BENEFIT_BUTTONS: CadenceButton[] = [
  {
    id: "activate",
    title: "Ativar benefício",
    goto_step_key: "a6_ask_bill_photo",
  },
  { id: "human", title: "Falar com humano", goto_special: "humano" },
  { id: "how_it_works", title: "Como funciona", goto_special: "ai" },
];

/**
 * Destino padrão ao adicionar preset no Multicanal (Grupo A).
 * Alinhado ao template sofia_ativacao_multicanal / construtor original.
 */
export const PRESET_DEFAULT_GOTO: Record<
  string,
  Pick<CadenceButton, "goto_step_key" | "goto_special">
> = {
  more_benefits: { goto_step_key: "a5b_after_club_buttons", goto_special: null },
  activate: { goto_step_key: "a6_ask_bill_photo", goto_special: null },
  register: { goto_step_key: "a6_ask_bill_photo", goto_special: null },
  cadastrar: { goto_step_key: "a6_ask_bill_photo", goto_special: null },
  simular: { goto_step_key: "a6_ask_bill_photo", goto_special: null },
  humano: { goto_step_key: null, goto_special: "humano" },
  human: { goto_step_key: null, goto_special: "humano" },
  como: { goto_step_key: null, goto_special: "ai" },
  duvida: { goto_step_key: "a3b_pedir_pergunta", goto_special: null },
};

/** Valor do Select “Quando clicar, vai para” (igual StepInspector). */
export function buttonGotoSelectValue(b: CadenceButton): string {
  if (b.goto_special) return `special:${b.goto_special}`;
  if (b.goto_step_key) return `stepkey:${b.goto_step_key}`;
  return "none";
}

export function parseButtonGotoSelect(
  value: string,
): Pick<CadenceButton, "goto_step_key" | "goto_special"> {
  if (value.startsWith("special:")) {
    return {
      goto_special: value.slice(8) as CadenceButtonGotoSpecial,
      goto_step_key: null,
    };
  }
  if (value.startsWith("stepkey:")) {
    return { goto_step_key: value.slice(8), goto_special: null };
  }
  return { goto_step_key: null, goto_special: null };
}

export function validateWhapiButtons(buttons: CadenceButton[] | undefined): {
  ok: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  if (!buttons || buttons.length === 0) return { ok: true, errors };
  if (buttons.length > WHAPI_MAX_BUTTONS) {
    errors.push(`Máximo ${WHAPI_MAX_BUTTONS} botões iGreen Chat (recebeu ${buttons.length})`);
  }
  for (const b of buttons) {
    if (!b.id?.trim()) errors.push("Botão sem id");
    if (!b.title?.trim()) errors.push(`Botão ${b.id || "?"} sem título`);
    if ((b.title || "").length > WHAPI_MAX_BUTTON_TITLE) {
      errors.push(`"${b.title}" tem ${(b.title || "").length} chars (máx ${WHAPI_MAX_BUTTON_TITLE})`);
    }
  }
  return { ok: errors.length === 0, errors };
}

export type AvailabilitySlot =
  | "before_1630"
  | "1630_1730"
  | "after_1730"
  | "after_1800"
  | "closed";

export type AvailabilityOverrideKey =
  | "before_1630"
  | "1630_1730"
  | "after_1730"
  | "after_1800";

export type AvailabilityOverrides = Partial<Record<AvailabilityOverrideKey, string>>;

/** Keys do catálogo Multicanal (aba Disponibilidade). */
export const AVAILABILITY_BODY_KEYS: Record<AvailabilityOverrideKey, string> = {
  before_1630: "availability_before_1630",
  "1630_1730": "availability_1630_1730",
  after_1730: "availability_after_1730",
  after_1800: "availability_after_1800",
};

export const DEFAULT_AVAILABILITY_PHRASES: Record<AvailabilityOverrideKey, string> = {
  before_1630: "Estou disponível hoje até as 18 horas.",
  "1630_1730": "Ainda estou disponível hoje até as 18 horas.",
  after_1730:
    "Ainda estou disponível hoje até as 18 horas — se preferir, seguimos no próximo horário de atendimento.",
  after_1800:
    "Recebi sua solicitação e deixei seu atendimento preparado. No próximo horário de atendimento, nossa equipe dará continuidade.",
};

function pickAvailabilityOverride(
  overrides: AvailabilityOverrides | undefined,
  key: AvailabilityOverrideKey,
): string {
  const custom = overrides?.[key]?.trim();
  return custom || DEFAULT_AVAILABILITY_PHRASES[key];
}

/** Lê frases editadas na biblioteca (aba Disponibilidade). */
export function availabilityOverridesFromLibrary(
  lib: { bodies?: Record<string, string> } | null | undefined,
): AvailabilityOverrides {
  const bodies = lib?.bodies;
  if (!bodies) return {};
  const out: AvailabilityOverrides = {};
  for (const [slot, key] of Object.entries(AVAILABILITY_BODY_KEYS) as Array<
    [AvailabilityOverrideKey, string]
  >) {
    const v = bodies[key]?.trim();
    if (v) out[slot] = v;
  }
  return out;
}

/** Frase dinâmica de disponibilidade (America/Sao_Paulo). */
export function buildAvailabilityPhrase(
  now: Date = new Date(),
  overrides?: AvailabilityOverrides,
): { phrase: string; slot: AvailabilitySlot } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Sao_Paulo",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const mins = hour * 60 + minute;
  const closedPhrase = pickAvailabilityOverride(overrides, "after_1800");

  if (wd === "Sun" || wd === "Sat") {
    return { slot: "closed", phrase: closedPhrase };
  }
  if (mins >= 18 * 60) return { slot: "after_1800", phrase: closedPhrase };
  if (mins >= 17 * 60 + 30) {
    return {
      slot: "after_1730",
      phrase: pickAvailabilityOverride(overrides, "after_1730"),
    };
  }
  if (mins >= 16 * 60 + 30) {
    return {
      slot: "1630_1730",
      phrase: pickAvailabilityOverride(overrides, "1630_1730"),
    };
  }
  if (mins >= 9 * 60) {
    return {
      slot: "before_1630",
      phrase: pickAvailabilityOverride(overrides, "before_1630"),
    };
  }
  return { slot: "closed", phrase: closedPhrase };
}

/** Variáveis de prévia / TTS do Multicanal (painel + geração de áudio). */
export type CadenceBodyRenderOpts = {
  nome?: string;
  now?: Date;
  valorFormatado?: string;
  /** Alias de valorFormatado — usado no passo 3 ({{valor_conta}}). */
  valorConta?: string;
  economiaMin?: string;
  economiaMax?: string;
  /** Ex.: "R$ 40 a R$ 100" — passo 3 {{economia_range}}. */
  economiaRange?: string;
  telefone?: string;
  telefoneMascarado?: string;
  gender?: SpeechGender;
  linkFacial?: string;
  /** Dígitos do WhatsApp do consultor (com DDI 55) → {{consultor_phone}} / {{link_wa}}. */
  consultorPhone?: string;
  /**
   * Nome humano do consultor (Dados → display_name).
   * {{consultor}} / {{representante}}. Vazio → placeholder fica para o painel avisar.
   */
  consultor?: string;
  /** Nome da IA (Dados → assistant_name). {{assistente}}. */
  assistente?: string;
  /**
   * Gênero do representante (Dados → gender).
   * Resolve {{do_da_consultor}}. Default: consultor (do).
   * {{gestor_a}} legado → vazio (não rotular como gestor).
   */
  consultorGender?: "consultor" | "consultora";
  /** Frases da aba Disponibilidade (lib.bodies). */
  availabilityOverrides?: AvailabilityOverrides;
};

/**
 * Prenome humano a partir de display_name / name.
 * Slug de login (tvmensal12) → "" — não vaza username no TTS.
 */
export function firstNameFromConsultantLabel(raw: string | null | undefined): string {
  const display = String(raw || "").trim();
  if (!display) return "";
  const isSlugLike =
    !/\s/.test(display) &&
    display === display.toLowerCase() &&
    (/\d/.test(display) || display.length >= 9);
  if (isSlugLike) return "";
  return display.split(/\s+/)[0] || display;
}

export function renderCadenceBody(
  body: string,
  opts: CadenceBodyRenderOpts = {},
): string {
  const nome = (opts.nome || "Cliente").trim() || "Cliente";
  const { phrase } = buildAvailabilityPhrase(
    opts.now ?? new Date(),
    opts.availabilityOverrides,
  );
  const g = genderLexicon(opts.gender ?? "masculino");
  const valor =
    (opts.valorConta ?? opts.valorFormatado ?? "").trim() || "…";
  const economiaRange =
    (opts.economiaRange ?? "").trim() ||
    (opts.economiaMin && opts.economiaMax
      ? `R$ ${opts.economiaMin} a R$ ${opts.economiaMax}`
      : "…");
  const telefone =
    (opts.telefone ?? opts.telefoneMascarado ?? "").trim() || "(11) 9••••-••••";
  const consultorPhone = normalizeConsultantPhoneDigits(opts.consultorPhone);
  const linkWa = consultorPhone
    ? `https://wa.me/${consultorPhone}`
    : "https://wa.me/{{consultor_phone}}";
  // Dados do consultor — sem inventar "Rafael". Slug/vazio mantém {{…}} p/ o painel bloquear TTS.
  const consultor = firstNameFromConsultantLabel(opts.consultor);
  const assistente = String(opts.assistente || "").trim() || "Sofia";
  const isConsultora = opts.consultorGender === "consultora";
  const doDaConsultor = isConsultora ? "da" : "do";
  // abertura_sofia primeiro (injeta {{assistente}}/{{consultor}}); depois resolve identidade.
  return [
    ["{{nome}}", nome],
    ["{{frase_disponibilidade}}", phrase],
    ["{{abertura_sofia}}", SOFIA_OPENING],
    ["{{valor_formatado}}", valor],
    ["{{valor_conta}}", valor],
    ["{{economia_min}}", opts.economiaMin ?? "…"],
    ["{{economia_max}}", opts.economiaMax ?? "…"],
    ["{{economia_range}}", economiaRange],
    ["{{telefone}}", telefone],
    ["{{telefone_mascarado}}", telefone],
    ["{{link_facial}}", opts.linkFacial ?? ""],
    // Sem telefone: não apagar o placeholder (evita SMS com `https://wa.me/` quebrado na prévia).
    ["{{consultor_phone}}", consultorPhone || "{{consultor_phone}}"],
    ["{{link_wa}}", linkWa],
    ["{{consultor}}", consultor || "{{consultor}}"],
    ["{{representante}}", consultor || "{{representante}}"],
    ["{{assistente}}", assistente],
    ["{{do_da_consultor}}", doDaConsultor],
    // Legado: templates antigos com {{gestor_a}} — não chamar de gestor.
    ["{{gestor_a}}", ""],
    ["{{bem_vindo}}", g.bem_vindo],
    ["{{o_a}}", g.o_a],
    ["{{do_da}}", g.do_da],
    ["{{ao_a}}", g.ao_a],
    ["{{querido_a}}", g.querido_a],
  ].reduce((acc, [k, v]) => tplReplace(acc, k, v), body)
    // Legado sem {{gestor_a}}: "…,  da iGreen" → "… da iGreen"
    .replace(/,\s+da iGreen/gi, " da iGreen")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Texto falado de um corte para TTS/cache.
 * - `name` com template “Olá, {{nome}}.” → “Olá, Nome.”
 * - `name` com “Então, {{nome}}.” → “Então, Nome.” (passo 3 / 3b / 4a)
 * - `name` com “{{nome}}, não tem segredo.” → legado (não usado no passo 3)
 * - `name` com só “{{nome}}.” → “Nome.” (legado)
 */
export function spokenSegmentText(
  seg: AudioSegment,
  opts: CadenceBodyRenderOpts = {},
): string {
  // firstNameOnly("") retorna "Cliente" — checar o raw antes, senão o
  // guarda abaixo nunca dispara e o TTS fala "Então, Cliente.".
  const rawNome = (opts.nome ?? "").trim();
  const first = rawNome ? firstNameOnly(rawNome) : "";
  if (seg.kind === "name") {
    // Sem nome confiável → corte vazio (painel/motor pulam; não TTS "Cliente").
    if (!first) return "";
    const raw = (seg.text || "").trim();
    // Só o nome (legado): Então fica no corte fixo.
    if (!raw || raw === "{{nome}}" || raw === "{{nome}}." || raw === "{{nome}}!") {
      return `${first}.`;
    }
    return renderCadenceBody(raw, { ...opts, nome: first }).trim();
  }
  return renderCadenceBody(seg.text, { ...opts, nome: first || "Cliente" }).trim();
}

/** Placeholders de identidade que impedem TTS (áudio sairia “consultor” literal). */
export function unresolvedConsultantIdentityPlaceholders(text: string): string[] {
  const missing: string[] = [];
  if (/\{\{\s*consultor\s*\}\}/i.test(text) || /\{\{\s*representante\s*\}\}/i.test(text)) {
    missing.push("consultor");
  }
  if (/\{\{\s*assistente\s*\}\}/i.test(text)) missing.push("assistente");
  return missing;
}

/** Link WhatsApp clicável no SMS (sempre https:// — sem protocolo o celular não abre). */
export const SMS_CONSULTOR_WA_LINK = "https://wa.me/{{consultor_phone}}";

/** Força protocolo https em qualquer wa.me/ do texto (templates antigos sem https). */
export function ensureHttpsWaMeLinks(body: string): string {
  return String(body || "").replace(
    /(?:https?:\/\/)?wa\.me\/(?=[\d+]|\{\{)/gi,
    "https://wa.me/",
  );
}

/** Garante https://wa.me do consultor em todo SMS — sem depender de eu editar cada texto. */
export function ensureSmsConsultorWaLink(body: string): string {
  let t = ensureHttpsWaMeLinks(String(body || "").trim());
  if (!t) return t;
  // Slot de tema: o motor troca {{tema_sms}} por um SMS que JÁ traz wa.me.
  // Se appendarmos aqui, o publish grava link duplo → Velip Blocked text#270.
  if (/^\{\{\s*tema_sms\s*\}\}$/i.test(t)) return t;
  // Remove wa.me/ vazio/quebrado (sem dígitos nem placeholder).
  t = t.replace(/(?:https?:\/\/)?wa\.me\/(?![\d+]|\{\{)/gi, "").replace(/\s{2,}/g, " ").trim();
  if (
    /wa\.me\/(?:[\d+]+|\{\{\s*consultor_phone\s*\}\})/i.test(t) ||
    /\{\{\s*link_wa\s*\}\}/i.test(t) ||
    /\{\{\s*consultor_phone\s*\}\}/i.test(t)
  ) {
    return ensureHttpsWaMeLinks(t);
  }
  return `${t} ${SMS_CONSULTOR_WA_LINK}`.replace(/\s{2,}/g, " ").trim();
}

/** Telefone do consultor para wa.me: DDI 55 + 9º dígito quando faltar (celular BR). */
export function normalizeConsultantPhoneDigits(raw: string | null | undefined): string {
  return normalizeBrazilPhone(raw);
}

export function smsCharCount(
  body: string,
  opts?: { consultorPhone?: string },
): number {
  const withLink = ensureSmsConsultorWaLink(body);
  return renderCadenceBody(withLink, {
    nome: "Maria",
    consultorPhone: opts?.consultorPhone || "5511999999999",
  }).length;
}

/**
 * Catálogo padrão — nome primeiro; perguntas com botão ≤ 3.
 */
export const MULTICHANNEL_CADENCE_TEMPLATES: CadenceTemplate[] = [
  // ─── Disponibilidade ────────────────────────────────────────────────────
  {
    key: "availability_before_1630",
    group: "availability",
    channel: "system",
    title: "Frase — antes das 16h30",
    timing: "09:00–16:29",
    canGenerateAudio: false,
    body: "Estou disponível hoje até as 18 horas.",
  },
  {
    key: "availability_1630_1730",
    group: "availability",
    channel: "system",
    title: "Frase — 16h30–17h30",
    timing: "16:30–17:29",
    canGenerateAudio: false,
    body: "Ainda estou disponível hoje até as 18 horas.",
  },
  {
    key: "availability_after_1730",
    group: "availability",
    channel: "system",
    title: "Frase — após 17h30",
    timing: "17:30–17:59",
    canGenerateAudio: false,
    body: "Ainda estou disponível hoje até as 18 horas — se preferir, seguimos no próximo horário de atendimento.",
  },
  {
    key: "availability_after_1800",
    group: "availability",
    channel: "system",
    title: "Frase — após 18h / fora da janela",
    timing: "≥18:00, fim de semana",
    canGenerateAudio: false,
    body: "Recebi sua solicitação e deixei seu atendimento preparado. No próximo horário de atendimento, nossa equipe dará continuidade.",
  },

  // ─── GRUPO A — 3 esperas: NOME → VALOR → EXPLICAÇÃO ─────────────────────
  // Regra de ouro:
  //  1) Envia pedido de nome e AGUARDA digitar
  //  2) Após nome: áudio+texto (ativar benefício {{nome}}) e AGUARDA valor
  //  3) Após valor: UM passo — texto desconto → áudio (nome + explicação) → botões
  //
  // No construtor: SMS e ligação são passos opcionais (send_sms / make_call)
  // que o consultor encaixa onde quiser — não são obrigatórios nesta sequência.
  {
    key: "a1_ask_name",
    group: "A",
    channel: "whatsapp_text",
    title: "1 — Pedir NOME (aguardar digitar)",
    timing: "T+0 · AGUARDA resposta com o nome",
    canGenerateAudio: false,
    notes:
      "OBRIGATÓRIO aguardar. Sem botões. Marca iGreen + apresentação do consultor + protocolo + pedido do nome.",
    body: `*iGreen | Conta de Luz Mais Barata 🌱*

Olá! Aqui é *{{representante}}* da *iGreen*.

Seu atendimento foi iniciado com sucesso e eu vou acompanhar você durante todo o processo.

📋 *Protocolo:* {{protocolo}}

Para agilizar seu atendimento, por favor, informe seu *primeiro nome*.`,
  },
  {
    key: "a2_audio_activate_name",
    group: "A",
    channel: "whatsapp_audio",
    title: "2a — Áudio: Olá+{{nome}} tudo bem?",
    timing: "Após nome salvo · antes de pedir valor",
    canGenerateAudio: true,
    notes:
      "2 cortes: 1) Olá+Nome+tudo bem? (mesma frase das ligações · cache) 2) corpo FIXO M/F (sem {{nome}}). Motor NÃO regenera corpo.",
    audioSegments: [
      {
        ...SEG_NAME_GREET,
        id: "a2_name",
        label: "1 · Olá + nome + tudo bem? (único corte variável · PT-BR)",
      },
      {
        id: "a2_body_feminino",
        kind: "fixed",
        genderVariant: "feminino",
        label: "2 · Corpo feminino (fixo · cache · sem nome)",
        text: A2_BODY_EXPLAIN_FEMININO,
      },
      {
        id: "a2_body_masculino",
        kind: "fixed",
        genderVariant: "masculino",
        label: "3 · Corpo masculino (fixo · cache · sem nome)",
        text: A2_BODY_EXPLAIN_MASCULINO,
      },
    ],
    body: joinAudioSegmentTexts([
      { text: "Olá, {{nome}}! Tudo bem?" },
      { text: A2_BODY_EXPLAIN },
    ]),
  },
  {
    key: "a2_text_ask_bill_value",
    group: "A",
    channel: "whatsapp_text",
    title: "2b — Texto: ativar {{nome}} + pedir valor (aguardar)",
    timing: "4s após áudio 2a · AGUARDA digitar o valor",
    canGenerateAudio: false,
    pairedAudioKey: "a2_audio_activate_name",
    notes:
      "Ordem: áudio 2a ACIMA → espera 4s → este texto. AGUARDA valor. Sem botões. Após valor → passo 3. Nunca pular este texto.",
    body: `Olá, *{{nome}}*!

Conseguimos ativar o seu benefício!

Para eu calcular a economia, me diga *quanto você paga por mês* na conta de energia.

Pode ser só o número — por exemplo: 350 ou 850,00.`,
  },
  {
    key: "a3_explain_with_buttons",
    group: "A",
    channel: "whatsapp_buttons",
    title: "3 — Áudio (nome+explicação) + texto com botões",
    timing: "Após valor digitado · áudio → 4s → texto + botões",
    canGenerateAudio: true,
    audioPlacement: "before_text",
    notes:
      "Ordem: 1) áudio “Então + nome” + explicação (corpo FIXO) 2) 4s 3) texto economia + botões. Sem Olá de novo. Sem nome → só o corpo.",
    body: `Perfeito, *{{nome}}*!

Com base no valor de *R$ {{valor_conta}}*, hoje você consegue economizar de *8% a 20%* todos os meses — cerca de *{{economia_range}}*.

*O que você prefere agora*?`,
    buttons: [...AFTER_EXPLAIN_BUTTONS],
    audioSegments: [
      {
        ...SEG_ENTAO_NOME,
        id: "a3_name",
        label: "1 · Então + nome (variável · PT-BR · cache por nome)",
      },
      {
        id: "a3_body",
        kind: "fixed",
        label: "2 · Explicação + “É simples” (fixo · cache · sem nome)",
        text: `Deixa eu te explicar de um jeito simples como funciona o benefício.

Nossas fazendas solares geram energia todos os dias e injetam na rede da sua distribuidora — CEMIG, CPFL, Copel e outras.

Você continua com a mesma conta e o mesmo medidor. O que muda é o crédito de energia limpa, sem placa e sem obra na sua casa.

Assim você economiza todo mês e reduz o impacto das bandeiras amarela e vermelha.

Não tem nenhum custo para você. Nenhum consultor pede depósito, Pix ou pagamento para ativar.

É simples.`,
      },
    ],
  },
  {
    key: "a3b_pedir_pergunta",
    group: "A",
    channel: "whatsapp_audio",
    title: "3b — Tenho dúvida (áudio convite)",
    timing: "Após “Tenho dúvida” no passo 3 ou 4 · só áudio · aguarda texto",
    canGenerateAudio: true,
    notes:
      "Padrão Sofia: Então + nome (variável) + corpo FIXO com temas FAQ. Sem nome → só o corpo. Lead pergunta → IA → volta ao passo 3.",
    body: joinAudioSegmentTexts([
      { text: "Então, {{nome}}." },
      {
        text: `Pode mandar sua dúvida por escrito que eu te respondo agora.

Pode perguntar se tem fidelidade, se tem taxa escondida, se precisa instalar placa, se funciona em apartamento, quanto você economiza, se atende na sua cidade… ou por que a gente pede documento.

Qualquer uma dessas — ou outra. E se eu não souber te explicar direito, eu chamo o consultor pra te ajudar.`,
      },
    ]),
    audioSegments: [
      {
        ...SEG_ENTAO_NOME,
        id: "a3b_name",
        label: "1 · Então + nome (variável · PT-BR · cache por nome)",
      },
      {
        id: "a3b_body",
        kind: "fixed",
        label: "2 · Convite + temas FAQ (fixo · cache · sem nome)",
        text: `Pode mandar sua dúvida por escrito que eu te respondo agora.

Pode perguntar se tem fidelidade, se tem taxa escondida, se precisa instalar placa, se funciona em apartamento, quanto você economiza, se atende na sua cidade… ou por que a gente pede documento.

Qualquer uma dessas — ou outra. E se eu não souber te explicar direito, eu chamo o consultor pra te ajudar.`,
      },
    ],
  },
  {
    key: "a3_audio_explain",
    group: "A",
    channel: "whatsapp_audio",
    title: "3 — Áudio (legado · mesmo do passo 3)",
    timing: "Alias do áudio do passo 3 unificado",
    canGenerateAudio: true,
    hiddenInPanel: true,
    notes:
      "Chave legada: o áudio é editado/gerado no passo 3 (texto + áudio + botões). Mantida para URLs antigas.",
    audioSegments: [
      {
        ...SEG_ENTAO_NOME,
        id: "a3_name",
        label: "1 · Então + nome (variável · cache por nome)",
      },
      {
        id: "a3_body",
        kind: "fixed",
        label: "2 · Explicação + “É simples” (fixo · cache)",
        text: `Deixa eu te explicar de um jeito simples como funciona o benefício.

Nossas fazendas solares geram energia todos os dias e injetam na rede da sua distribuidora — CEMIG, CPFL, Copel e outras.

Você continua com a mesma conta e o mesmo medidor. O que muda é o crédito de energia limpa, sem placa e sem obra na sua casa.

Assim você economiza todo mês e reduz o impacto das bandeiras amarela e vermelha.

Não tem nenhum custo para você. Nenhum consultor pede depósito, Pix ou pagamento para ativar.

É simples.`,
      },
    ],
    body: joinAudioSegmentTexts([
      { text: "Então, {{nome}}." },
      {
        text: `Deixa eu te explicar de um jeito simples como funciona o benefício.

Nossas fazendas solares geram energia todos os dias e injetam na rede da sua distribuidora — CEMIG, CPFL, Copel e outras.

Você continua com a mesma conta e o mesmo medidor. O que muda é o crédito de energia limpa, sem placa e sem obra na sua casa.

Assim você economiza todo mês e reduz o impacto das bandeiras amarela e vermelha.

Não tem nenhum custo para você. Nenhum consultor pede depósito, Pix ou pagamento para ativar.

É simples.`,
      },
    ]),
  },
  {
    key: "a5_audio_club_benefits",
    group: "A",
    channel: "whatsapp_audio",
    title: "4a — Áudio clube (Então + nome + benefício)",
    timing: "Após Saber mais benefício · áudio → 4s → 4b",
    canGenerateAudio: true,
    notes:
      "2 cortes: 1) Então + Nome (PT-BR) 2) corpo FIXO do clube/benefício (sem {{nome}}). Sem nome → só o corpo. Ordem: áudio ACIMA → 4b.",
    audioSegments: [
      {
        ...SEG_ENTAO_NOME,
        id: "a5_name",
        label: "1 · Então + nome (variável · PT-BR · cache por nome)",
      },
      {
        id: "a5_body",
        kind: "fixed",
        label: "2 · Corpo do clube / benefício (fixo · cache · sem nome)",
        text: `Eu sempre gosto de lembrar que o benefício vai muito além da economia na conta de energia.

Ao ativar, você também passa a ter acesso a um clube de benefícios com mais de 30 mil estabelecimentos parceiros em todo o Brasil.

Um dos benefícios mais utilizados é o desconto em farmácias, que pode chegar a até 70% em medicamentos. Você também pode encontrar até 60% de desconto em cinemas, além de vantagens em restaurantes, lojas e diversos serviços.

Ou seja: você economiza na energia e ainda pode economizar em várias despesas do dia a dia.`,
      },
    ],
    body: joinAudioSegmentTexts([
      { text: "Então, {{nome}}." },
      {
        text: `Eu sempre gosto de lembrar que o benefício vai muito além da economia na conta de energia.

Ao ativar, você também passa a ter acesso a um clube de benefícios com mais de 30 mil estabelecimentos parceiros em todo o Brasil.

Um dos benefícios mais utilizados é o desconto em farmácias, que pode chegar a até 70% em medicamentos. Você também pode encontrar até 60% de desconto em cinemas, além de vantagens em restaurantes, lojas e diversos serviços.

Ou seja: você economiza na energia e ainda pode economizar em várias despesas do dia a dia.`,
      },
    ]),
  },
  {
    key: "a5b_after_club_buttons",
    group: "A",
    channel: "whatsapp_buttons",
    title: "4b — Texto + Ativar / Dúvida / Humano",
    timing: "4s após áudio 4a · AGUARDA clique",
    canGenerateAudio: false,
    pairedAudioKey: "a5_audio_club_benefits",
    notes:
      "Nunca pular. Ordem: áudio 4a → 4s → este texto + botões. Ativar → passo 5 (foto conta). Dúvida → a3b. Humano → handoff.",
    body: `Olá, *{{nome}}*!

📋 Vamos ativar seu benefício?

Toque em *Ativar benefício* para continuar 👇`,
    buttons: [...AFTER_CLUB_BUTTONS],
  },
  {
    key: "a6_ask_bill_photo",
    group: "A",
    channel: "whatsapp_text",
    title: "5 — Pedir foto da conta (OCR)",
    timing: "Após Ativar benefício",
    canGenerateAudio: false,
    body: `✅ *Perfeito, {{nome}}!*

📸 *Agora me envie a foto da sua conta de luz*

• Página com o *valor* e os *dados da unidade*
• Foto *nítida*, sem reflexos
• Pode ser a fatura mais recente

Assim valido tudo automaticamente e seguimos com a ativação 💚`,
  },
  {
    key: "a6_ocr_retry",
    group: "A",
    channel: "whatsapp_text",
    title: "5b — Erro leitura da conta",
    timing: "Quando o OCR da conta falhar · continua aguardando foto",
    canGenerateAudio: true,
    linkedToStepKey: "a6_ask_bill_photo",
    audioPlacement: "after_text",
    notes:
      "Ligado ao passo 5. Não avança o funil — reenvia texto (+ áudio opcional) e continua em aguardando_conta. Sync grava em fallback.retry_* do capture_conta.",
    body: `⚠️ Não consegui ler a conta. Por favor, envie uma *foto mais nítida e bem iluminada* (sem reflexos).

Dicas:
• Use boa iluminação
• Evite reflexos
• Foque nos dados principais`,
  },
  {
    key: "a7_ask_document",
    group: "A",
    channel: "whatsapp_text",
    title: "6 — Pedir documento",
    timing: "Após conta validada (OCR)",
    canGenerateAudio: false,
    notes:
      "Motor: CNH = só frente. RG = frente + verso obrigatório. OCR lê nome/CPF/RG/nascimento; se faltar CPF, pede digitar.",
    body: `Olá, *{{nome}}*!

📄 *Próximo passo!*

Me envie a foto do seu *documento com foto*:

🪪 *CNH* → só a *frente*

🆔 *RG* → *frente e verso* (obrigatório)

Preciso das fotos *nítidas* para continuar seu cadastro ✅`,
  },
  {
    key: "a7_ocr_retry",
    group: "A",
    channel: "whatsapp_text",
    title: "6b — Erro leitura do documento",
    timing: "Quando o OCR do documento falhar · continua aguardando foto",
    canGenerateAudio: true,
    linkedToStepKey: "a7_ask_document",
    audioPlacement: "after_text",
    notes:
      "Ligado ao passo 6. Não avança o funil — reenvia texto (+ áudio opcional) e continua aguardando o documento. Sync grava em fallback.retry_* do capture_documento.",
    body: `⚠️ Não consegui ler o documento. Envie uma foto mais nítida do *VERSO* (ou da frente, se for CNH).

Dicas:
• Boa iluminação, sem reflexo
• Texto legível (nome, CPF, RG)`,
  },
  {
    key: "a8_ask_email",
    group: "A",
    channel: "whatsapp_text",
    title: "7 — Pedir e-mail",
    timing: "Após documento",
    canGenerateAudio: false,
    notes: "Mesmo padrão do fluxo D (ask_email / step-goal): e-mail = acesso ao app iGreen Club.",
    body: `Olá, *{{nome}}*!

📧 Qual é o seu *e-mail*?

É por ele que você acessa o app *iGreen Club* 📱

_(cashback, faturas e indicações)_`,
  },
  {
    key: "a9_confirm_phone",
    group: "A",
    channel: "whatsapp_buttons",
    title: "8 — Confirmar telefone",
    timing: "Após e-mail · depois → 9 código → 10 facial",
    canGenerateAudio: false,
    notes:
      "Após telefone: passo 9 (portal + digitar código). Só DEPOIS do código validado → passo 10 (link da facial). Mensagens 9b/9c/9d = código rejeitado (confirm).",
    body: `Olá, *{{nome}}*!

📱 Só confirmar:

O telefone deste WhatsApp é o melhor para contato?

*Número:* {{telefone}}`,
    buttons: [
      {
        id: "phone_ok",
        title: "Sim, este número",
        goto_step_key: "a10_portal_otp_facial",
      },
      { id: "phone_other", title: "Quero outro", goto_special: "repeat" },
      { id: "human", title: "Falar com humano", goto_special: "humano" },
    ],
  },
  {
    key: "a10_portal_otp_facial",
    group: "A",
    channel: "whatsapp_text",
    title: "9 — Portal + digitar código",
    timing: "Após telefone confirmado · AGUARDA o código",
    canGenerateAudio: false,
    notes:
      "Ordem obrigatória: 1) envia cadastro ao portal 2) cliente digita o código aqui 3) só então passo 10 com link da facial. NÃO enviar facial neste passo. Ao cliente diga sempre *código* (nunca OTP).",
    body: `Olá, *{{nome}}*!

🎉 *Pronto!*

Já temos todos os dados ✅

Vou enviar seu cadastro ao portal agora.

📲 Em seguida você recebe um *código* — digite aqui no WhatsApp 👇

_(O link da validação facial só vem *depois* do código correto.)_`,
  },
  {
    key: "a10_codigo_confirm_ask",
    group: "A",
    channel: "whatsapp_buttons",
    title: "9b — Código rejeitado: confirmar",
    timing: "Quando o portal não aceitar o código digitado",
    canGenerateAudio: false,
    linkedToStepKey: "a10_portal_otp_facial",
    notes:
      "Ligado ao passo 9. Não avança o funil. Pergunta se o código digitado é o mesmo que chegou. Use {{codigo}}. Sync grava em fallback do a10.",
    body: `Recebi o código *{{codigo}}*, mas o portal *não aceitou* 😕

Confirma que *é esse mesmo* o código que chegou no seu WhatsApp?`,
    buttons: [...CODIGO_CONFIRM_BUTTONS],
  },
  {
    key: "a10_codigo_confirm_sim",
    group: "A",
    channel: "whatsapp_text",
    title: "9c — Confirmou código → chamar consultor",
    timing: "Cliente diz que o código está certo",
    canGenerateAudio: false,
    linkedToStepKey: "a10_portal_otp_facial",
    notes:
      "Resposta ao cliente após ele confirmar. O sistema pausa o bot e avisa o consultor automaticamente.",
    body: `Perfeito, anotei ✅

Vou chamar o *consultor* agora para ele liberar seu cadastro com esse código. Em breve ele te responde por aqui.`,
  },
  {
    key: "a10_codigo_confirm_nao",
    group: "A",
    channel: "whatsapp_text",
    title: "9d — Código errado: digitar de novo",
    timing: "Cliente diz que digitou errado",
    canGenerateAudio: false,
    linkedToStepKey: "a10_portal_otp_facial",
    notes: "Pede o código correto. Use só a palavra *código*.",
    body: `Sem problema! Digite aqui o *código correto* que chegou no WhatsApp (só os números).`,
  },
  {
    key: "a11_facial_link",
    group: "A",
    channel: "whatsapp_text",
    title: "10 — Link da facial (após código)",
    timing: "Só depois do código validado",
    canGenerateAudio: false,
    notes:
      "Nunca antes do código. Sistema envia o link da selfie/facial após validação. Placeholder {{link_facial}} quando disponível.",
    body: `Olá, *{{nome}}*!

✅ *Código confirmado!*

Último passo — abra o *link* 👇

{{link_facial}}

Toque em *Assinar documentos* e faça a *validação facial* para comprovar que é você 🪪`,
  },
  {
    key: "a10_title_transfer_sp",
    group: "A",
    channel: "whatsapp_buttons",
    title: "9a — Transferência de título SP (legado · fora do fluxo)",
    timing: "NÃO usar — após telefone → código → facial",
    canGenerateAudio: false,
    hiddenInPanel: true,
    notes:
      "Legado. Fluxo atual: telefone → código (9) → facial (10). Mantido só por compatibilidade.",
    body: `Olá, *{{nome}}*!

Em São Paulo, para concluir a ativação, pode ser necessária a transferência de titularidade da conta, conforme as regras da distribuidora.

Nossa equipe orienta o passo a passo — sem custo de ativação cobrado por consultor.

Vamos seguir com essa etapa?`,
    buttons: [
      { id: "continue_sp", title: "Seguir com SP" },
      { id: "human", title: "Falar com humano" },
      { id: "later", title: "Agora não" },
    ],
  },
  {
    key: "a10b_mg_no_title_transfer",
    group: "A",
    channel: "whatsapp_text",
    title: "9b — MG cadastro (legado · fora do fluxo)",
    timing: "NÃO usar — após telefone → código → facial",
    canGenerateAudio: false,
    hiddenInPanel: true,
    notes:
      "Legado. Fluxo atual: telefone → código (9) → facial (10). Mantido só por compatibilidade.",
    body: `Olá, *{{nome}}*!

Vamos seguir com o seu cadastro para ativar o benefício.

A cobrança é em *boleto único*, na própria conta de energia — sem custo de ativação.

Vou te pedir só os dados necessários para concluir.`,
  },
  {
    key: "a_human_handoff",
    group: "A",
    channel: "whatsapp_text",
    title: "Handoff — falar com humano",
    timing: "Qualquer botão “Falar com humano”",
    canGenerateAudio: false,
    body: `Olá, *{{nome}}*!

Combinado.

Vou transferir você para um atendente da equipe de {{consultor}}. Em instantes alguém assume a conversa por aqui.`,
  },
  {
    key: "a_optional_sms_slot",
    group: "A",
    channel: "sms",
    title: "Opcional — SMS (encaixe no construtor)",
    timing: "Consultor escolhe o momento no fluxo",
    canGenerateAudio: false,
    maxChars: 160,
    notes: "Passo send_sms no construtor — não é obrigatório na sequência 1→2→3.",
    body: `{{assistente}} | iGreen: Oi {{nome}}! Ative seu beneficio no WhatsApp: https://wa.me/{{consultor_phone}}`,
  },
  {
    key: "a_optional_call_slot",
    group: "A",
    channel: "call_script",
    title: "Opcional — Ligação Sofia (encaixe no construtor)",
    timing: "Consultor escolhe o momento no fluxo",
    canGenerateAudio: true,
    notes:
      "Ligação GRAVADA (MakeTTSCall). Só CTA WhatsApp — sem perguntas. Passo make_call opcional.",
    audioSegments: [
      {
        id: "call_body",
        kind: "fixed",
        label: "1 · Corpo gravado (CTA WhatsApp)",
        text: recordedCallBody(
          "Estou ligando sobre a ativação do seu benefício de economia na conta de energia.",
        ),
      },
    ],
    body: recordedCallBody(
      "Estou ligando sobre a ativação do seu benefício de economia na conta de energia.",
    ),
  },

  // ─── GRUPO A — escada de silêncio (pizza: Retomada → SMS → Ligação → Fecha A) ─
  // NÃO entram no grafo do fluxo Sofia: só no motor (cadence_stage_config / cadence-tick).
  {
    key: "a_nudge_wa",
    group: "A",
    channel: "whatsapp_text",
    title: "Escada · Retomada no WhatsApp (cutuca)",
    timing: "Após ~2h de silêncio em GREETED / Ativo · A_NUDGE",
    canGenerateAudio: false,
    notes:
      "Texto que o motor envia na fatia Retomada. Salva em cadence_stage_config (A_NUDGE). Não cria passo no construtor.",
    // Neutro (sem "o/a"): serve consultor e consultora. Nome/IA vêm do consultor do lead.
    body: `*Oi, {{nome}}*! Aqui é *{{consultor}}* da *iGreen* ⚡

Todo mês a *conta de luz chega*… e muitas pessoas só descobrem depois que estavam *pagando mais* do que precisavam.

Você chegou a *iniciar sua simulação*, mas não finalizamos.
*Vamos continuar* de onde paramos?

*Me confirma* seu primeiro nome para eu *seguir com o atendimento?* 😊`,
  },
  {
    key: "a_nudge_sms",
    group: "A",
    channel: "sms",
    title: "Escada · SMS de reforço",
    timing: "~2h após retomada sem resposta · A_SMS",
    canGenerateAudio: false,
    maxChars: 160,
    notes: "SMS da escada A. Motor: cadence_stage_config (A_SMS).",
    body: `{{assistente}} | iGreen: Oi {{nome}}! Ative seu beneficio no WhatsApp: https://wa.me/{{consultor_phone}}`,
  },
  {
    key: "a_nudge_call",
    group: "A",
    channel: "call_script",
    title: "Escada · Ligação (1ª voz)",
    timing: "~2h após SMS sem resposta · A_CALL",
    canGenerateAudio: true,
    notes:
      "Ligação GRAVADA · A_CALL. Só pede WhatsApp. Runtime pode costurar Olá+nome; corpo sem perguntas.",
    audioSegments: [
      { ...SEG_CALL_NAME_GREET, label: "1 · Olá + nome (costura runtime)" },
      {
        id: "a_nudge_call_body",
        kind: "fixed",
        label: "2 · Corpo gravado (CTA WhatsApp)",
        text: recordedCallBody(
          "Estou ligando sobre a ativação do seu benefício de economia na conta de energia.",
        ),
      },
    ],
    body: joinAudioSegmentTexts([
      { text: "Olá, {{nome}}!" },
      {
        text: recordedCallBody(
          "Estou ligando sobre a ativação do seu benefício de economia na conta de energia.",
        ),
      },
    ]),
  },
  {
    key: "a_nudge_call_retry",
    group: "A",
    channel: "call_script",
    title: "Escada · Fecha A (última tentativa)",
    timing: "~30 min após 1ª ligação · A_CALL_RETRY → Grupo B",
    canGenerateAudio: true,
    notes:
      "Ligação GRAVADA · A_CALL_RETRY. Só CTA WhatsApp. Sem resposta → COLD_1.",
    audioSegments: [
      { ...SEG_CALL_NAME_GREET, label: "1 · Olá + nome (costura runtime)" },
      {
        id: "a_nudge_call_retry_body",
        kind: "fixed",
        label: "2 · Corpo gravado (CTA WhatsApp)",
        text: recordedCallBody(
          "Estou ligando novamente sobre a ativação do seu benefício de economia na conta de energia.",
        ),
      },
    ],
    body: joinAudioSegmentTexts([
      { text: "Olá, {{nome}}!" },
      {
        text: recordedCallBody(
          "Estou ligando novamente sobre a ativação do seu benefício de economia na conta de energia.",
        ),
      },
    ]),
  },

  // ─── GRUPO B (lead já está no CRM — já mandou mensagem antes) ───────────
  {
    key: "b0_ask_name",
    group: "B",
    channel: "whatsapp_text",
    title: "1 — Pedir o nome (só se faltar no CRM)",
    timing: "D+1 · no começo · só se o nome estiver faltando ou inválido",
    canGenerateAudio: false,
    notes:
      "O lead já está no CRM (já mandou mensagem). Se o nome já estiver certo, pula esta etapa e vai direto para a reabertura. Sem botões — o cliente digita o nome.",
    body: `Olá! 👋 Aqui é *{{consultor}}*, da *iGreen Energia*.

Estou reabrindo seu atendimento sobre *economia na conta de luz*. ⚡

Para agilizar, me diga *seu primeiro nome*, por favor.`,
  },
  {
    key: "b1_wa_reopen",
    group: "B",
    channel: "whatsapp_buttons",
    title: "2 — Reabrir atendimento (perguntar faixa da conta)",
    timing: "D+1 · envia às 09h30",
    canGenerateAudio: false,
    notes:
      "WhatsApp com 3 botões de faixa. Usa o nome que já está no CRM. Se precisar de foto/ligar/encerrar, segue o passo seguinte.",
    body: `Olá, *{{nome}}*! 👋

Aqui é *{{consultor}}*, da *iGreen*.

Você já demonstrou interesse em *reduzir sua conta de luz* — e agora temos uma novidade:

✅ Conseguimos iniciar sua análise *apenas com o valor médio da conta*. Sem foto, sem burocracia.

{{frase_disponibilidade}}

*Em qual faixa está sua conta hoje?*

_Para não receber mais contatos, responda SAIR._`,
    buttons: [...BILL_RANGE_BUTTONS],
  },
  {
    key: "b1_wa_reopen_b3",
    group: "B",
    channel: "whatsapp_buttons",
    title: "2 — Reabrir lead parado há mais tempo",
    timing: "D+1 · envia às 09h30",
    canGenerateAudio: false,
    notes:
      "Versão para quem pediu informação há bastante tempo. Não diga que há atendimento pendente se não houver histórico.",
    body: `Olá, *{{nome}}*! 👋

Aqui é *{{consultor}}*, da *iGreen*.

Faz um tempo que você pediu informações sobre *economia na conta de luz* — e agora ficou *muito mais simples* começar. ⚡

✅ Iniciamos sua análise *só com o valor médio da conta*.

{{frase_disponibilidade}}

*Em qual faixa está sua conta hoje?* 👇

_Para não receber mais contatos, responda SAIR._`,
    buttons: [...BILL_RANGE_BUTTONS],
  },
  {
    key: "b1b_wa_next_action",
    group: "B",
    channel: "whatsapp_buttons",
    title: "2b — Outras opções (foto, ligar ou encerrar)",
    timing: "D+1 · depois das 09h30 · só se precisar",
    canGenerateAudio: false,
    notes: "Oferece continuar de outro jeito: enviar foto, pedir ligação ou encerrar.",
    body: `Olá, *{{nome}}*!

Prefere continuar de outra forma? 👇

Escolha a opção mais prática pra você:`,
    buttons: [...NEXT_ACTION_BUTTONS],
  },
  {
    key: "b2_wa_audio",
    group: "B",
    channel: "whatsapp_audio",
    title: "3 — Áudio de reativação (Sofia · ~30s)",
    timing: "D+1 · envia às 09h32 · só com nome no CRM",
    canGenerateAudio: true,
    notes: "Sempre voz Sofia. Abertura fixa; o nome entra só no cumprimento.",
    audioSegments: [
      { ...SEG_CALL_NAME_GREET, label: "1 · Olá + nome + tudo bem? (ligação)" },
      {
        id: "b2_body",
        kind: "fixed",
        label: "2 · Corpo do áudio (fixo · cache)",
        text: `Eu sou {{assistente}}, assistente virtual de {{consultor}}, da iGreen Energia.

Estou retornando porque você já pediu informações sobre economia na conta de luz — e agora ficou muito mais simples começar sua análise com {{consultor}}.

Conseguimos iniciar apenas com o valor médio da sua conta. Sem foto, sem burocracia.

{{frase_disponibilidade}}

Importante: não existe Pix, depósito ou pagamento ao consultor. Basta me responder aqui com o valor aproximado da sua conta que {{consultor}} segue com você.`,
      },
    ],
    body: joinAudioSegmentTexts([
      { text: "Olá, {{nome}}." },
      { text: `Eu sou {{assistente}}, assistente virtual de {{consultor}}, da iGreen Energia.

Estou retornando porque você já pediu informações sobre economia na conta de luz — e agora ficou muito mais simples começar sua análise com {{consultor}}.

Conseguimos iniciar apenas com o valor médio da sua conta. Sem foto, sem burocracia.

{{frase_disponibilidade}}

Importante: não existe Pix, depósito ou pagamento ao consultor. Basta me responder aqui com o valor aproximado da sua conta que {{consultor}} segue com você.` },
    ]),

  },
  {
    key: "b3_sms_1",
    group: "B",
    channel: "sms",
    title: "4 — Primeiro SMS",
    timing: "D+1 · envia às 11h30 · só se silêncio no WA",
    canGenerateAudio: false,
    maxChars: 160,
    body: `{{consultor}} | iGreen: Oi {{nome}}! Reabri sua analise. Abra: https://wa.me/{{consultor_phone}} SAIR encerra.`,
  },
  {
    key: "b4_call_1",
    group: "B",
    channel: "call_script",
    title: "5 — Primeira ligação (Sofia)",
    timing: "D+1 · entre 15h e 17h · só se ainda silêncio",
    canGenerateAudio: true,
    notes: "Ligação GRAVADA · CALL_1. Só CTA WhatsApp — sem perguntas nem ramificações.",
    audioSegments: [
      { ...SEG_CALL_NAME_GREET, label: "1 · Olá + nome (costura runtime)" },
      {
        id: "b4_body",
        kind: "fixed",
        label: "2 · Corpo gravado (CTA WhatsApp)",
        text: recordedCallBody(
          "Você já demonstrou interesse em reduzir sua conta de luz. Agora conseguimos iniciar a análise apenas com o valor médio da conta.",
        ),
      },
    ],
    body: joinAudioSegmentTexts([
      { text: "Olá, {{nome}}!" },
      {
        text: recordedCallBody(
          "Você já demonstrou interesse em reduzir sua conta de luz. Agora conseguimos iniciar a análise apenas com o valor médio da conta.",
        ),
      },
    ]),
  },
  {
    key: "b_day2_wa",
    group: "B",
    channel: "whatsapp_buttons",
    title: "Dia 2 — WhatsApp com tema (rotativo)",
    timing: "Dia 2 · envia às 10h30 · só se silêncio no D+1",
    canGenerateAudio: false,
    notes:
      "Não edite o texto aqui. No Dia 2 o motor escolhe UM tema da aba Temas (análise, bandeiras, sem placas, segurança…). Diferente do D+1 (reabrir). Em silêncio ~2h → SMS tema.",
    body: `{{tema_whatsapp}}`,
    buttons: [...BILL_RANGE_BUTTONS],
  },
  {
    key: "b_day2_sms_tema",
    group: "B",
    channel: "sms",
    title: "Dia 2 — SMS do mesmo tema (só se silêncio)",
    timing: "Dia 2 · ~2h após o WA · só se silêncio",
    canGenerateAudio: false,
    maxChars: 160,
    notes:
      "Não edite aqui. Usa o SMS do mesmo tema escolhido no WhatsApp (aba Temas). Placeholder {{tema_sms}}.",
    body: `{{tema_sms}}`,
  },
  {
    key: "b_day4_call_2",
    group: "B",
    channel: "call_script",
    title: "Dia 4 — Segunda ligação (Sofia)",
    timing: "Dia 4 · entre 14h30 e 17h · espaçada (anti-spam)",
    canGenerateAudio: true,
    notes: "Ligação GRAVADA · CALL_2. Só CTA WhatsApp.",
    audioSegments: [
      { ...SEG_CALL_NAME_GREET, label: "1 · Olá + nome (costura runtime)" },
      {
        id: "d4_body",
        kind: "fixed",
        label: "2 · Corpo gravado (CTA WhatsApp)",
        text: recordedCallBody(
          "Estou retornando com uma atualização sobre a economia na conta de luz.",
        ),
      },
    ],
    body: joinAudioSegmentTexts([
      { text: "Olá, {{nome}}!" },
      {
        text: recordedCallBody(
          "Estou retornando com uma atualização sobre a economia na conta de luz.",
        ),
      },
    ]),
  },
  {
    key: "b_day6_sms_2",
    group: "B",
    channel: "sms",
    title: "Dia 6 — Segundo SMS",
    timing: "Dia 6 · envia às 11h30 · sem ligação no mesmo dia",
    canGenerateAudio: false,
    maxChars: 160,
    body: `{{consultor}} | iGreen: Oi {{nome}}! Novidades e beneficios extras. Abra: https://wa.me/{{consultor_phone}} SAIR encerra.`,
  },
  {
    key: "b_day7_wa_easy",
    group: "B",
    channel: "whatsapp_buttons",
    title: "Dia 7 — Resposta fácil (faixa da conta)",
    timing: "Dia 7 · envia às 10h30",
    canGenerateAudio: false,
    notes:
      "3 botões de faixa. Se precisar de foto, ligação ou encerrar, usa o passo seguinte. Em silêncio → SMS_TEMA_7.",
    body: `Olá, *{{nome}}*! 👋

Sem mensagem longa, sem foto: pra checar seu caso *basta 1 toque*.

*Qual faixa está sua conta hoje?*`,
    buttons: [...BILL_RANGE_BUTTONS],
  },
  {
    key: "b_day7_sms_tema",
    group: "B",
    channel: "sms",
    title: "Dia 7 — SMS do tema (só se silêncio)",
    timing: "Dia 7 · ~2h após WA · só se silêncio",
    canGenerateAudio: false,
    maxChars: 160,
    notes:
      "Não edite aqui. Outro tema rotativo (aba Temas), diferente do último. Placeholder {{tema_sms}}.",
    body: `{{tema_sms}}`,
  },
  {
    key: "b_day7b_wa_action",
    group: "B",
    channel: "whatsapp_buttons",
    title: "Dia 7 — Outras opções (foto, ligar ou encerrar)",
    timing: "Dia 7 · depois das 10h30 · só se precisar",
    canGenerateAudio: false,
    body: `Olá, *{{nome}}*!

Ou prefere outra opção? 👇`,
    buttons: [...NEXT_ACTION_BUTTONS],
  },
  {
    key: "b_day10_call",
    group: "B",
    channel: "call_script",
    title: "Dia 10 — Ligação final (Sofia)",
    timing: "Dia 10 · envia às 15h · encerramento educado da onda",
    canGenerateAudio: true,
    notes: "Ligação GRAVADA · CALL_3. Só CTA WhatsApp — sem perguntar se quer encerrar.",
    audioSegments: [
      { ...SEG_CALL_NAME_GREET, label: "1 · Olá + nome (costura runtime)" },
      {
        id: "d10_body",
        kind: "fixed",
        label: "2 · Corpo gravado (CTA WhatsApp)",
        text: recordedCallBody(
          "Estou concluindo esta sequência para não ficar insistindo. Sua análise continua disponível — basta o valor médio ou uma foto da conta.",
        ),
      },
    ],
    body: joinAudioSegmentTexts([
      { text: "Olá, {{nome}}!" },
      {
        text: recordedCallBody(
          "Estou concluindo esta sequência para não ficar insistindo. Sua análise continua disponível — basta o valor médio ou uma foto da conta.",
        ),
      },
    ]),
  },
  {
    key: "b_day10_wa_final",
    group: "B",
    channel: "whatsapp_buttons",
    title: "Dia 10 — WhatsApp final (pausar atendimento)",
    timing: "Dia 10 · depois da ligação · se não atender",
    canGenerateAudio: false,
    notes:
      "Fim da onda intensa (CLOSE_LOST no motor). Recall longo / Meta podem seguir depois — não é exclusão do cadastro.",
    body: `Olá, *{{nome}}*.

Como não consegui falar com você, vou *pausar este ciclo* — sem excluir seu cadastro.

*Escolha abaixo* como prefere seguir (ou responda SAIR para não receber mais contatos):`,
    buttons: [
      { id: "analyze", title: "Quero analisar" },
      { id: "call_me", title: "Pode me ligar" },
      { id: "stop", title: "Encerrar" },
    ],
  },

  // ─── GRUPO C (longo prazo — Meta + recalls após onda B) ─────────────────
  {
    key: "c_meta_close_lost",
    group: "C",
    channel: "system",
    title: "Meta — fim da onda (CLOSE_LOST)",
    timing: "Logo após Dia 10 · sem WhatsApp",
    canGenerateAudio: false,
    notes:
      "Não envia mensagem ao lead. Marca fim da onda curta e prepara fila de Custom Audience. Toggle facebook_retarget_sync na Central de Automações.",
    body: `Este passo NÃO manda WhatsApp, SMS ou ligação.

O lead concluiu a onda de reaquecimento (Grupo B) sem converter. O motor registra CLOSE_LOST e, se o sync Meta estiver ON, inclui telefone/e-mail (hash) na Custom Audience.

Criativo/imagem de anúncio: Meta Ads Manager ou Ads Central — não configura aqui.`,
  },
  {
    key: "c_meta_sync_audience",
    group: "C",
    channel: "system",
    title: "Meta — sync Custom Audience (RETARGET_META)",
    timing: "~1 dia após CLOSE_LOST",
    canGenerateAudio: false,
    notes: "Sobe hash para público Meta. Sem texto para o lead.",
    body: `Sync técnico com Meta (Custom Audience).

Requer facebook_retarget_sync ON + credenciais Meta OK. Não escolhe criativo nem budget — só alimenta a lista para remarketing posterior.`,
  },
  {
    key: "c_meta_ads_15d",
    group: "C",
    channel: "system",
    title: "Meta — remarketing ~15 dias (RETARGET_ADS_15D)",
    timing: "~15 dias após sync · toggle cadence_retarget_ads_15d",
    canGenerateAudio: false,
    notes: "Estágio de remarketing ads. Criativo no Ads Manager.",
    body: `Marco de remarketing ~15 dias após fim da onda.

Toggle cadence_retarget_ads_15d (Central de Automações). O anúncio em si roda no Meta Ads — este painel só controla se o lead entra na escada longa.`,
  },
  // Cada marco: WA análise → SMS se silêncio → ligação se silêncio
  {
    key: "c_recall_60d_wa",
    group: "C",
    channel: "whatsapp_buttons",
    title: "1º recall (~30d) — WhatsApp (análise)",
    timing: "~14d após Meta · ~30d após Dia 10 · WA primeiro",
    canGenerateAudio: false,
    notes: "RECALL_60D (delay 336h ≈ 14d após Meta/ads). Em silêncio → SMS → ligação (toggle cadence_recall_60d).",
    body: `Olá, *{{nome}}*! 👋

Aqui é *{{consultor}}*, da *iGreen*.

Faz cerca de *1 mês* que falamos sobre *economia na conta de luz*.

✅ Sua *análise continua disponível* — iniciamos só com o *valor médio* da conta. Sem foto, sem burocracia.

{{frase_disponibilidade}}

*Em qual faixa está sua conta hoje?*

_Para não receber mais contatos, responda SAIR._`,
    buttons: [...BILL_RANGE_BUTTONS],
  },
  {
    key: "c_recall_60d_sms",
    group: "C",
    channel: "sms",
    title: "60d — SMS (se silêncio)",
    timing: "~2h após WA · só se silêncio",
    canGenerateAudio: false,
    maxChars: 160,
    notes: "RECALL_60D_SMS.",
    body: `{{consultor}} | iGreen: Oi {{nome}}! Sua analise de economia segue disponivel. Abra: https://wa.me/{{consultor_phone}} SAIR encerra.`,
  },
  {
    key: "c_recall_60d_call",
    group: "C",
    channel: "call_script",
    title: "60d — Ligação Sofia (se silêncio)",
    timing: "~4h após SMS · só se silêncio",
    canGenerateAudio: true,
    notes: "Ligação GRAVADA · RECALL_60D_CALL. Só CTA WhatsApp.",
    audioSegments: [
      { ...SEG_CALL_NAME_GREET, label: "1 · Olá + nome (costura runtime)" },
      {
        id: "c60_call_body",
        kind: "fixed",
        label: "2 · Corpo gravado (CTA WhatsApp)",
        text: recordedCallBody(
          "Faz cerca de um mês que falamos sobre economia na conta de luz. Sua análise continua disponível — só com o valor médio da conta, sem foto.",
        ),
      },
    ],
    body: joinAudioSegmentTexts([
      { text: "Olá, {{nome}}!" },
      {
        text: recordedCallBody(
          "Faz cerca de um mês que falamos sobre economia na conta de luz. Sua análise continua disponível — só com o valor médio da conta, sem foto.",
        ),
      },
    ]),
  },
  {
    key: "c_recall_90d_wa",
    group: "C",
    channel: "whatsapp_buttons",
    title: "90d — WhatsApp (análise)",
    timing: "~90 dias · WA primeiro",
    canGenerateAudio: false,
    notes: "RECALL_90D. Em silêncio → SMS → ligação.",
    body: `Olá, *{{nome}}*! 👋

Aqui é *{{consultor}}*, da *iGreen*.

Faz cerca de *3 meses* desde nosso contato sobre *reduzir a conta de luz*.

✅ Posso *retomar sua análise de economia* agora — só com o valor médio da conta. Sem foto obrigatória.

{{frase_disponibilidade}}

*Em qual faixa está sua conta hoje?* 👇

_Para não receber mais contatos, responda SAIR._`,
    buttons: [...BILL_RANGE_BUTTONS],
  },
  {
    key: "c_recall_90d_sms",
    group: "C",
    channel: "sms",
    title: "90d — SMS (se silêncio)",
    timing: "~2h após WA · só se silêncio",
    canGenerateAudio: false,
    maxChars: 160,
    notes: "RECALL_90D_SMS.",
    body: `{{consultor}} | iGreen: Oi {{nome}}! Ainda posso retomar sua analise da conta. Abra: https://wa.me/{{consultor_phone}} SAIR encerra.`,
  },
  {
    key: "c_recall_90d_call",
    group: "C",
    channel: "call_script",
    title: "90d — Ligação Sofia (se silêncio)",
    timing: "~4h após SMS · só se silêncio",
    canGenerateAudio: true,
    notes: "Ligação GRAVADA · RECALL_90D_CALL. Só CTA WhatsApp.",
    audioSegments: [
      { ...SEG_CALL_NAME_GREET, label: "1 · Olá + nome (costura runtime)" },
      {
        id: "c90_call_body",
        kind: "fixed",
        label: "2 · Corpo gravado (CTA WhatsApp)",
        text: recordedCallBody(
          "Faz cerca de três meses que conversamos sobre economia na conta. Posso retomar sua análise só com o valor médio — sem burocracia.",
        ),
      },
    ],
    body: joinAudioSegmentTexts([
      { text: "Olá, {{nome}}!" },
      {
        text: recordedCallBody(
          "Faz cerca de três meses que conversamos sobre economia na conta. Posso retomar sua análise só com o valor médio — sem burocracia.",
        ),
      },
    ]),
  },
  {
    key: "c_recall_5m_wa",
    group: "C",
    channel: "whatsapp_buttons",
    title: "5 meses — WhatsApp (análise)",
    timing: "~5 meses · WA primeiro",
    canGenerateAudio: false,
    notes: "RECALL_5M. Em silêncio → SMS → ligação.",
    body: `Olá, *{{nome}}*! 👋

Aqui é *{{consultor}}*, da *iGreen*.

Faz cerca de *5 meses* que falamos sobre *economia na conta de luz*.

✅ Sua *análise continua disponível* — iniciamos só com o *valor médio*. Sem foto, sem burocracia.

{{frase_disponibilidade}}

*Em qual faixa está sua conta hoje?*

_Para não receber mais contatos, responda SAIR._`,
    buttons: [...BILL_RANGE_BUTTONS],
  },
  {
    key: "c_recall_5m_sms",
    group: "C",
    channel: "sms",
    title: "5 meses — SMS (se silêncio)",
    timing: "~2h após WA · só se silêncio",
    canGenerateAudio: false,
    maxChars: 160,
    notes: "RECALL_5M_SMS.",
    body: `{{consultor}} | iGreen: Oi {{nome}}! Analise de economia ainda disponivel. Abra: https://wa.me/{{consultor_phone}} SAIR encerra.`,
  },
  {
    key: "c_recall_5m_call",
    group: "C",
    channel: "call_script",
    title: "5 meses — Ligação Sofia (se silêncio)",
    timing: "~4h após SMS · só se silêncio",
    canGenerateAudio: true,
    notes: "Ligação GRAVADA · RECALL_5M_CALL. Só CTA WhatsApp.",
    audioSegments: [
      { ...SEG_CALL_NAME_GREET, label: "1 · Olá + nome (costura runtime)" },
      {
        id: "c5m_body",
        kind: "fixed",
        label: "2 · Corpo gravado (CTA WhatsApp)",
        text: recordedCallBody(
          "Faz cerca de cinco meses que conversamos sobre economia na conta de luz. Sua análise continua disponível — só com o valor médio da conta, sem foto.",
        ),
      },
    ],
    body: joinAudioSegmentTexts([
      { text: "Olá, {{nome}}!" },
      {
        text: recordedCallBody(
          "Faz cerca de cinco meses que conversamos sobre economia na conta de luz. Sua análise continua disponível — só com o valor médio da conta, sem foto.",
        ),
      },
    ]),
  },
  {
    key: "c_recall_8m_wa",
    group: "C",
    channel: "whatsapp_buttons",
    title: "8 meses — WhatsApp (análise)",
    timing: "~8 meses · WA primeiro",
    canGenerateAudio: false,
    notes: "RECALL_8M. Em silêncio → SMS → ligação.",
    body: `Olá, *{{nome}}*! 👋

Aqui é *{{consultor}}*, da *iGreen*.

Faz cerca de *8 meses* desde nosso contato sobre *economia na conta*.

✅ Posso *retomar sua análise* agora — só com o valor médio. Sem foto obrigatória.

{{frase_disponibilidade}}

*Em qual faixa está sua conta hoje?*

_Para não receber mais contatos, responda SAIR._`,
    buttons: [...BILL_RANGE_BUTTONS],
  },
  {
    key: "c_recall_8m_sms",
    group: "C",
    channel: "sms",
    title: "8 meses — SMS (se silêncio)",
    timing: "~2h após WA · só se silêncio",
    canGenerateAudio: false,
    maxChars: 160,
    notes: "RECALL_8M_SMS.",
    body: `{{consultor}} | iGreen: Oi {{nome}}! Novidades na economia de energia. Abra: https://wa.me/{{consultor_phone}} SAIR encerra.`,
  },
  {
    key: "c_recall_8m_call",
    group: "C",
    channel: "call_script",
    title: "8 meses — Ligação Sofia (se silêncio)",
    timing: "~4h após SMS · só se silêncio",
    canGenerateAudio: true,
    notes: "Ligação GRAVADA · RECALL_8M_CALL. Só CTA WhatsApp.",
    audioSegments: [
      { ...SEG_CALL_NAME_GREET, label: "1 · Olá + nome (costura runtime)" },
      {
        id: "c8m_call_body",
        kind: "fixed",
        label: "2 · Corpo gravado (CTA WhatsApp)",
        text: recordedCallBody(
          "Faz cerca de oito meses que falamos sobre economia na conta. Sua análise continua disponível com o valor médio.",
        ),
      },
    ],
    body: joinAudioSegmentTexts([
      { text: "Olá, {{nome}}!" },
      {
        text: recordedCallBody(
          "Faz cerca de oito meses que falamos sobre economia na conta. Sua análise continua disponível com o valor médio.",
        ),
      },
    ]),
  },
  {
    key: "c_recall_12m_wa",
    group: "C",
    channel: "whatsapp_buttons",
    title: "12 meses — WhatsApp (análise)",
    timing: "~1 ano · WA primeiro",
    canGenerateAudio: false,
    notes: "RECALL_12M. Em silêncio → SMS → ligação.",
    body: `Olá, *{{nome}}*! 👋

Aqui é *{{consultor}}*, da *iGreen*.

Faz cerca de *1 ano* desde nosso contato sobre economia na conta.

✅ Sua *análise de economia* continua disponível — basta o valor médio da conta.

{{frase_disponibilidade}}

*Em qual faixa está sua conta hoje?*

_Para não receber mais contatos, responda SAIR._`,
    buttons: [...BILL_RANGE_BUTTONS],
  },
  {
    key: "c_recall_12m_sms",
    group: "C",
    channel: "sms",
    title: "12 meses — SMS (se silêncio)",
    timing: "~2h após WA · só se silêncio",
    canGenerateAudio: false,
    maxChars: 160,
    notes: "RECALL_12M_SMS.",
    body: `{{consultor}} | iGreen: Oi {{nome}}! Faz 1 ano — analise ainda disponivel. Abra: https://wa.me/{{consultor_phone}} SAIR encerra.`,
  },
  {
    key: "c_recall_12m_call",
    group: "C",
    channel: "call_script",
    title: "12 meses — Ligação Sofia (se silêncio)",
    timing: "~4h após SMS · só se silêncio",
    canGenerateAudio: true,
    notes: "Ligação GRAVADA · RECALL_12M_CALL. Só CTA WhatsApp.",
    audioSegments: [
      { ...SEG_CALL_NAME_GREET, label: "1 · Olá + nome (costura runtime)" },
      {
        id: "c12m_call_body",
        kind: "fixed",
        label: "2 · Corpo gravado (CTA WhatsApp)",
        text: recordedCallBody(
          "Faz cerca de um ano que conversamos sobre economia na conta de luz. Sua análise continua disponível — só com o valor médio.",
        ),
      },
    ],
    body: joinAudioSegmentTexts([
      { text: "Olá, {{nome}}!" },
      {
        text: recordedCallBody(
          "Faz cerca de um ano que conversamos sobre economia na conta de luz. Sua análise continua disponível — só com o valor médio.",
        ),
      },
    ]),
  },
  {
    key: "c_recall_yearly_wa",
    group: "C",
    channel: "whatsapp_buttons",
    title: "Anual — WhatsApp (análise)",
    timing: "A cada ~1 ano · WA primeiro",
    canGenerateAudio: false,
    notes: "RECALL_YEARLY. Em silêncio → SMS → ligação → loop anual.",
    body: `Olá, *{{nome}}*! 👋

Aqui é *{{consultor}}*, da *iGreen*.

Lembrete anual: sua *análise de economia na conta* continua disponível.

✅ Iniciamos só com o *valor médio*. Sem foto, sem burocracia.

{{frase_disponibilidade}}

*Em qual faixa está sua conta hoje?*

_Para não receber mais contatos, responda SAIR._`,
    buttons: [...BILL_RANGE_BUTTONS],
  },
  {
    key: "c_recall_yearly_sms",
    group: "C",
    channel: "sms",
    title: "Anual — SMS (se silêncio)",
    timing: "~2h após WA · só se silêncio",
    canGenerateAudio: false,
    maxChars: 160,
    notes: "RECALL_YEARLY_SMS.",
    body: `{{consultor}} | iGreen: Oi {{nome}}! Lembrete anual da analise. Abra: https://wa.me/{{consultor_phone}} SAIR encerra.`,
  },
  {
    key: "c_recall_yearly_call",
    group: "C",
    channel: "call_script",
    title: "Anual — Ligação Sofia (se silêncio)",
    timing: "~4h após SMS · só se silêncio",
    canGenerateAudio: true,
    notes: "Ligação GRAVADA · RECALL_YEARLY_CALL. Só CTA WhatsApp.",
    audioSegments: [
      { ...SEG_CALL_NAME_GREET, label: "1 · Olá + nome (costura runtime)" },
      {
        id: "cyear_call_body",
        kind: "fixed",
        label: "2 · Corpo gravado (CTA WhatsApp)",
        text: recordedCallBody(
          "Este é o lembrete anual sobre economia na conta de luz. Sua análise continua disponível com o valor médio da conta.",
        ),
      },
    ],
    body: joinAudioSegmentTexts([
      { text: "Olá, {{nome}}!" },
      {
        text: recordedCallBody(
          "Este é o lembrete anual sobre economia na conta de luz. Sua análise continua disponível com o valor médio da conta.",
        ),
      },
    ]),
  },

  // ─── TEMAS (todos ≤ 3 botões) ───────────────────────────────────────────
  {
    key: "theme_simplified_analysis_wa",
    group: "theme",
    channel: "whatsapp_buttons",
    title: "Tema — Análise só com o valor da conta",
    timing: "Alternável · Dia 2 (e Dia 7 se silêncio)",
    theme: "simplified_analysis",
    canGenerateAudio: false,
    notes:
      "Um dos temas rotativos do Grupo B. Publish grava em cadence_theme_config (motor). Não é o 1º contato: o D+1 usa o texto fixo de reabrir. Dia 2 referencia {{tema_whatsapp}}.",
    body: `Olá, *{{nome}}*! 👋

Boa notícia: agora dá para começar sua *análise* só com o *valor médio* da conta — *sem foto* e *sem burocracia*. ✅

{{frase_disponibilidade}}

*Qual faixa está sua conta hoje?*`,
    buttons: [...BILL_RANGE_BUTTONS],
  },
  {
    key: "theme_simplified_analysis_sms",
    group: "theme",
    channel: "sms",
    title: "Tema — Análise só com o valor (SMS)",
    timing: "Alternável · Dia 2 ou 7 se silêncio",
    theme: "simplified_analysis",
    canGenerateAudio: false,
    maxChars: 160,
    body: `{{consultor}} | iGreen: Oi {{nome}}! Agora da pra analisar so com o valor da conta. Abra: https://wa.me/{{consultor_phone}} SAIR encerra.`,
  },
  {
    key: "theme_cruise_wa",
    group: "theme",
    channel: "whatsapp_buttons",
    title: "Tema — Cruzeiro (WA)",
    timing: "Só com CRUISE_CAMPAIGN_APPROVED",
    theme: "cruise",
    requiresApproval: "CRUISE_CAMPAIGN_APPROVED",
    canGenerateAudio: false,
    notes: "3 botões: economia / regras / ligar. Não afirmar “você ganhou”. Ainda SEM destino no motor (não entra no rotativo Dia 2/7).",
    body: `Olá, *{{nome}}*! Você sabia dessa novidade? 🚢

Além da *economia* na conta de energia, clientes elegíveis podem participar de um *sorteio de cabine de cruzeiro* para duas pessoas, conforme o regulamento vigente.

{{frase_disponibilidade}}

*O que você quer conhecer primeiro?*`,
    buttons: [
      { id: "economy", title: "Como funciona" },
      { id: "cruise_rules", title: "Regras do cruzeiro" },
      { id: "call_me", title: "Pode me ligar" },
    ],
  },
  {
    key: "theme_cruise_wa_coupon",
    group: "theme",
    channel: "whatsapp_text",
    title: "Tema — Cruzeiro cupom (texto extra)",
    timing: "Só com ADVANCE_PAYMENT_DOUBLE_COUPON_APPROVED",
    theme: "cruise",
    requiresApproval: "ADVANCE_PAYMENT_DOUBLE_COUPON_APPROVED",
    canGenerateAudio: false,
    body: `Conforme o regulamento vigente, o *pagamento antecipado* pode gerar uma *participação adicional*.`,
  },
  {
    key: "theme_cruise_audio",
    group: "theme",
    channel: "whatsapp_audio",
    title: "Tema — Cruzeiro (áudio Sofia)",
    timing: "Só com CRUISE_CAMPAIGN_APPROVED",
    theme: "cruise",
    requiresApproval: "CRUISE_CAMPAIGN_APPROVED",
    canGenerateAudio: true,
    audioSegments: [
      { ...SEG_CALL_NAME_GREET, label: "1 · Olá + nome + tudo bem? (ligação)" },
      {
        id: "cruise_body",
        kind: "fixed",
        label: "2 · Corpo do áudio (fixo · cache)",
        text: `Eu sou {{assistente}}, assistente virtual de {{consultor}}, da iGreen Energia.

Além da possibilidade de economia na conta de energia, existe uma novidade especial: clientes elegíveis podem participar de um sorteio de uma cabine de cruzeiro para duas pessoas, conforme o regulamento. Responda por aqui que eu explico as regras e também verifico sua análise de economia com {{consultor}}.`,
      },
    ],
    body: joinAudioSegmentTexts([
      { text: "Olá, {{nome}}." },
      { text: `Eu sou {{assistente}}, assistente virtual de {{consultor}}, da iGreen Energia.

Além da possibilidade de economia na conta de energia, existe uma novidade especial: clientes elegíveis podem participar de um sorteio de uma cabine de cruzeiro para duas pessoas, conforme o regulamento. Responda por aqui que eu explico as regras e também verifico sua análise de economia com {{consultor}}.` },
    ]),

  },
  {
    key: "theme_cruise_sms",
    group: "theme",
    channel: "sms",
    title: "Tema — Cruzeiro (SMS)",
    timing: "Só com CRUISE_CAMPAIGN_APPROVED",
    theme: "cruise",
    requiresApproval: "CRUISE_CAMPAIGN_APPROVED",
    canGenerateAudio: false,
    maxChars: 160,
    body: `{{consultor}} | iGreen: sorteio cabine cruzeiro p/2 (regulamento). Abra: https://wa.me/{{consultor_phone}} SAIR encerra.`,
  },
  {
    key: "theme_tariff_flags_wa",
    group: "theme",
    channel: "whatsapp_buttons",
    title: "Tema — Bandeiras tarifárias",
    timing: "Alternável",
    theme: "tariff_flags",
    canGenerateAudio: false,
    notes: "Nunca afirmar isenção de bandeira.",
    body: `Olá, *{{nome}}*!

As bandeiras *amarela* e *vermelha* podem aumentar o valor final da conta. ⚡

O benefício de economia pode *ajudar a reduzir* o impacto desses aumentos, conforme o consumo e as condições aplicáveis.

Quer *análise inicial* pelo valor médio? *Qual faixa?*`,
    buttons: [...BILL_RANGE_BUTTONS],
  },
  {
    key: "theme_tariff_flags_sms",
    group: "theme",
    channel: "sms",
    title: "Tema — Bandeiras (SMS)",
    timing: "Alternável",
    theme: "tariff_flags",
    canGenerateAudio: false,
    maxChars: 160,
    body: `{{consultor}} | Energia: bandeiras podem subir a conta. Abra: https://wa.me/{{consultor_phone}} SAIR encerra.`,
  },
  {
    key: "theme_no_home_panels_wa",
    group: "theme",
    channel: "whatsapp_buttons",
    title: "Tema — Sem placas / sem obra",
    timing: "Alternável",
    theme: "no_home_panels",
    canGenerateAudio: false,
    body: `Olá, *{{nome}}*! 👋

Para conhecer essa possibilidade de economia, *não é necessário* instalar placas solares na sua casa, fazer obra ou alterar sua instalação. ✅

A análise pode começar pelo *valor médio*. Como prefere?`,
    buttons: [
      { id: "explain", title: "Explicar por aqui" },
      { id: "call_me", title: "Pode me ligar" },
      { id: "send_photo", title: "Enviar foto" },
    ],
  },
  {
    key: "theme_no_home_panels_sms",
    group: "theme",
    channel: "sms",
    title: "Tema — Sem placas (SMS)",
    timing: "Alternável",
    theme: "no_home_panels",
    canGenerateAudio: false,
    maxChars: 160,
    body: `{{consultor}} | Energia: sem placas nem obra. Abra: https://wa.me/{{consultor_phone}} SAIR encerra.`,
  },
  {
    key: "theme_security_wa",
    group: "theme",
    channel: "whatsapp_buttons",
    title: "Tema — Segurança",
    timing: "Alternável",
    theme: "security",
    canGenerateAudio: false,
    body: `Olá, *{{nome}}*! Aqui é *{{consultor}}*.

🔒 *Reforço importante:* não pedimos Pix, depósito ou pagamento ao consultor para iniciar a análise.

{{frase_disponibilidade}}

Como prefere seguir?`,
    buttons: [...ANALYZE_OR_CALL_BUTTONS],
  },
  {
    key: "theme_security_sms",
    group: "theme",
    channel: "sms",
    title: "Tema — Segurança (SMS)",
    timing: "Alternável",
    theme: "security",
    canGenerateAudio: false,
    maxChars: 160,
    body: `{{consultor}} | iGreen: analise sem custo antecipado. Abra: https://wa.me/{{consultor_phone}} SAIR encerra.`,
  },
  {
    key: "theme_benefits_club_wa",
    group: "theme",
    channel: "whatsapp_buttons",
    title: "Tema — Clube de benefícios",
    timing: "Alternável · números só de config",
    theme: "benefits_club",
    canGenerateAudio: false,
    body: `Olá, *{{nome}}*! 👋

O benefício *não termina* na economia da conta: clientes elegíveis podem ter vantagens em estabelecimentos parceiros, conforme condições vigentes.

*O que você quer conhecer?*`,
    buttons: [
      { id: "economy", title: "Economia na conta" },
      { id: "club", title: "Clube benefícios" },
      { id: "call_me", title: "Pode me ligar" },
    ],
  },
  {
    key: "theme_benefits_club_sms",
    group: "theme",
    channel: "sms",
    title: "Tema — Clube (SMS)",
    timing: "Alternável",
    theme: "benefits_club",
    canGenerateAudio: false,
    maxChars: 160,
    body: `{{consultor}} | iGreen: economia + clube de parceiros. Abra: https://wa.me/{{consultor_phone}} SAIR encerra.`,
  },
  {
    key: "theme_referral_cashback_wa",
    group: "theme",
    channel: "whatsapp_buttons",
    title: "Tema — Indicação / cashback",
    timing: "Alternável · valor só de config",
    theme: "referral_cashback",
    canGenerateAudio: false,
    body: `Olá, *{{nome}}*! 👋

Além da própria economia, também podem existir *benefícios por indicação*, conforme as regras vigentes.

*O que você quer conhecer?*`,
    buttons: [
      { id: "economy", title: "Economia mensal" },
      { id: "referral", title: "Indicação" },
      { id: "call_me", title: "Pode me ligar" },
    ],
  },
  {
    key: "theme_referral_cashback_sms",
    group: "theme",
    channel: "sms",
    title: "Tema — Indicação (SMS)",
    timing: "Alternável",
    theme: "referral_cashback",
    canGenerateAudio: false,
    maxChars: 160,
    body: `{{consultor}} | iGreen: economia + indicacao (regras). Abra: https://wa.me/{{consultor_phone}} SAIR encerra.`,
  },
  {
    key: "theme_digital_app_wa",
    group: "theme",
    channel: "whatsapp_buttons",
    title: "Tema — App digital",
    timing: "Alternável · Dia 2 (e Dia 7 se silêncio)",
    theme: "digital_app",
    canGenerateAudio: false,
    body: `Olá, *{{nome}}*! 👋

Além da economia na conta, clientes elegíveis podem acompanhar o benefício pelo *aplicativo*, conforme as condições vigentes. 📱

{{frase_disponibilidade}}

Como prefere seguir?`,
    buttons: [...ANALYZE_OR_CALL_BUTTONS],
  },
  {
    key: "theme_digital_app_sms",
    group: "theme",
    channel: "sms",
    title: "Tema — App digital (SMS)",
    timing: "Alternável · Dia 2 ou 7 se silêncio",
    theme: "digital_app",
    canGenerateAudio: false,
    maxChars: 160,
    body: `{{consultor}} | iGreen: economia no app. Abra: https://wa.me/{{consultor_phone}} SAIR encerra.`,
  },
];

export function templatesByGroup(group: CadenceGroup): CadenceTemplate[] {
  return MULTICHANNEL_CADENCE_TEMPLATES.filter((t) => t.group === group);
}

export function getTemplate(key: string): CadenceTemplate | undefined {
  return MULTICHANNEL_CADENCE_TEMPLATES.find((t) => t.key === key);
}

export function assertCatalogWhapiSafe(): string[] {
  const errors: string[] = [];
  for (const t of MULTICHANNEL_CADENCE_TEMPLATES) {
    const v = validateWhapiButtons(t.buttons);
    if (!v.ok) errors.push(`${t.key}: ${v.errors.join("; ")}`);
    if (t.channel === "whatsapp_buttons" && (!t.buttons || t.buttons.length === 0)) {
      errors.push(`${t.key}: canal whatsapp_buttons sem botões`);
    }
    if (t.channel === "whatsapp_buttons" && (t.buttons?.length ?? 0) > WHAPI_MAX_BUTTONS) {
      errors.push(`${t.key}: mais de ${WHAPI_MAX_BUTTONS} botões`);
    }
  }
  return errors;
}

export type SavedCadenceLibrary = {
  version: 2;
  updatedAt: string;
  bodies: Record<string, string>;
  /** templateKey → segmentId → texto editado */
  segmentBodies: Record<string, Record<string, string>>;
  /** templateKey → segmentId → aprovado */
  segmentApproved: Record<string, Record<string, boolean>>;
  buttons: Record<string, CadenceButton[]>;
  approved: Record<string, boolean>;
  audioUrls: Record<string, string>;
  audioClipIds: Record<string, string>;
};

export function emptyLibrary(): SavedCadenceLibrary {
  return {
    version: 2,
    updatedAt: new Date().toISOString(),
    bodies: {},
    segmentBodies: {},
    segmentApproved: {},
    buttons: {},
    approved: {},
    audioUrls: {},
    audioClipIds: {},
  };
}

export function storageKey(consultantId: string): string {
  return `multichannel_cadence_texts_v2_${consultantId}`;
}

export function loadLibrary(consultantId: string): SavedCadenceLibrary {
  try {
    const raw = localStorage.getItem(storageKey(consultantId));
    const base = raw
      ? (() => {
          const parsed = JSON.parse(raw) as Partial<SavedCadenceLibrary>;
          return {
            ...emptyLibrary(),
            ...parsed,
            version: 2 as const,
            bodies: parsed.bodies ?? {},
            segmentBodies: parsed.segmentBodies ?? {},
            segmentApproved: parsed.segmentApproved ?? {},
            buttons: parsed.buttons ?? {},
            approved: parsed.approved ?? {},
            audioUrls: parsed.audioUrls ?? {},
            audioClipIds: parsed.audioClipIds ?? {},
          };
        })()
      : emptyLibrary();
    const merged = mergeApprovedA2Audios(base);
    return { ...base, ...merged };
  } catch {
    const base = emptyLibrary();
    const merged = mergeApprovedA2Audios(base);
    return { ...base, ...merged };
  }
}

export function saveLibrary(consultantId: string, lib: SavedCadenceLibrary): void {
  const next = { ...lib, version: 2 as const, updatedAt: new Date().toISOString() };
  localStorage.setItem(storageKey(consultantId), JSON.stringify(next));
}

export function resolveAudioSegments(
  tpl: CadenceTemplate,
  lib: SavedCadenceLibrary,
): AudioSegment[] {
  const base = tpl.audioSegments ?? [];
  if (!base.length) return [];
  const overrides = lib.segmentBodies[tpl.key] ?? {};
  return base.map((s) => ({
    ...s,
    text: (overrides[s.id]?.trim() ? overrides[s.id] : s.text),
  }));
}

export function resolveBody(tpl: CadenceTemplate, lib: SavedCadenceLibrary): string {
  // Passo misto (texto/botões + áudio): body = mensagem WhatsApp, não o roteiro TTS.
  const saved = lib.bodies[tpl.key];
  const savedOk = typeof saved === "string" && saved.trim().length > 0;
  if (tpl.channel !== "whatsapp_audio" && tpl.channel !== "call_script") {
    const raw = savedOk ? saved : tpl.body;
    return tpl.channel === "sms" ? ensureSmsConsultorWaLink(raw) : raw;
  }
  const segs = resolveAudioSegments(tpl, lib);
  if (segs.length) return joinAudioSegmentTexts(segs);
  return savedOk ? saved : tpl.body;
}

/** Slot do Grupo B que só referencia tema (`{{tema_whatsapp}}` / `{{tema_sms}}`). */
export function themePlaceholderKind(body: string): "wa" | "sms" | null {
  const t = String(body || "").trim();
  if (/\{\{\s*tema_whatsapp\s*\}\}/i.test(t)) return "wa";
  if (/\{\{\s*tema_sms\s*\}\}/i.test(t)) return "sms";
  return null;
}

/**
 * Temas que o motor pode escolher no Dia 2 / Dia 7 (sem cruzeiro — exige flag).
 * Ordem = mesma ideia do pool em cadence-themes.ts.
 */
export type RotatingCadenceThemeInfo = {
  id: string;
  label: string;
  waKey: string;
  smsKey: string;
};

export const ROTATING_CADENCE_THEMES: ReadonlyArray<RotatingCadenceThemeInfo> = [
  {
    id: "simplified_analysis",
    label: "Análise só com o valor da conta",
    waKey: "theme_simplified_analysis_wa",
    smsKey: "theme_simplified_analysis_sms",
  },
  {
    id: "tariff_flags",
    label: "Bandeiras tarifárias (amarela/vermelha)",
    waKey: "theme_tariff_flags_wa",
    smsKey: "theme_tariff_flags_sms",
  },
  {
    id: "no_home_panels",
    label: "Sem placas / sem obra em casa",
    waKey: "theme_no_home_panels_wa",
    smsKey: "theme_no_home_panels_sms",
  },
  {
    id: "security",
    label: "Segurança (não pedimos Pix)",
    waKey: "theme_security_wa",
    smsKey: "theme_security_sms",
  },
  {
    id: "benefits_club",
    label: "Clube de benefícios / parceiros",
    waKey: "theme_benefits_club_wa",
    smsKey: "theme_benefits_club_sms",
  },
  {
    id: "referral_cashback",
    label: "Indicação / cashback",
    waKey: "theme_referral_cashback_wa",
    smsKey: "theme_referral_cashback_sms",
  },
  {
    id: "digital_app",
    label: "Economia no app",
    waKey: "theme_digital_app_wa",
    smsKey: "theme_digital_app_sms",
  },
];

/** Corpo resolvido de um tema (WA ou SMS) para prévia no Dia 2/7. */
export function themeBodyForPreview(
  themeId: string,
  kind: "wa" | "sms",
  lib: SavedCadenceLibrary,
): string {
  const info =
    ROTATING_CADENCE_THEMES.find((t) => t.id === themeId) || ROTATING_CADENCE_THEMES[0]!;
  const key = kind === "wa" ? info.waKey : info.smsKey;
  const tpl = getTemplate(key);
  if (!tpl) return kind === "sms" ? SMS_CONSULTOR_WA_LINK : "";
  const body = resolveBody(tpl, lib);
  return kind === "sms" ? ensureSmsConsultorWaLink(body) : body;
}

/** @deprecated use themeBodyForPreview */
export function exampleThemeBodyForPreview(
  kind: "wa" | "sms",
  lib: SavedCadenceLibrary,
  themeId = "simplified_analysis",
): string {
  return themeBodyForPreview(themeId, kind, lib);
}

/** Já existe MP3 gerado para este template (chave base ou M/F). */
export function hasGeneratedCadenceAudio(
  tplKey: string,
  lib: SavedCadenceLibrary,
): boolean {
  if (lib.audioUrls[tplKey]) return true;
  if (lib.audioUrls[cadenceAudioUrlKey(tplKey, "feminino")]) return true;
  if (lib.audioUrls[cadenceAudioUrlKey(tplKey, "masculino")]) return true;
  if (lib.audioUrls[cadenceBodyAudioUrlKey(tplKey)]) return true;
  if (lib.audioUrls[cadenceBodyAudioUrlKey(tplKey, "feminino")]) return true;
  if (lib.audioUrls[cadenceBodyAudioUrlKey(tplKey, "masculino")]) return true;
  // Alias legado do passo 3
  if (tplKey === "a3_explain_with_buttons" && lib.audioUrls.a3_audio_explain) return true;
  // Clip no motor (cadence_stage_config) sem URL espelhada na lib
  if (lib.audioClipIds[tplKey]) return true;
  if (lib.audioClipIds[cadenceAudioUrlKey(tplKey, "feminino")]) return true;
  if (lib.audioClipIds[cadenceAudioUrlKey(tplKey, "masculino")]) return true;
  return false;
}

export function allAudioSegmentsApproved(
  tpl: CadenceTemplate,
  lib: SavedCadenceLibrary,
): boolean {
  const segs = resolveAudioSegments(tpl, lib);
  if (!segs.length) return !!lib.approved[tpl.key];
  // Se o MP3 já foi gerado, não bloqueia por Ok desligado após troca de ids/cortes.
  if (hasGeneratedCadenceAudio(tpl.key, lib)) return true;
  const map = lib.segmentApproved[tpl.key] ?? {};
  return segs.every((s) => !!map[s.id]);
}

export function resolveButtons(tpl: CadenceTemplate, lib: SavedCadenceLibrary): CadenceButton[] {
  const override = lib.buttons[tpl.key];
  const catalog = (tpl.buttons ?? []).slice(0, WHAPI_MAX_BUTTONS);
  if (!override?.length) return catalog;

  // Passos oficiais do funil A: se a lib salva está desatualizada (faltam botões
  // novos como “Tenho dúvida”, ou ainda tem só Cadastrar/Humano), usa o catálogo.
  // Senão o preview fica eternamente com o override antigo do localStorage/remoto.
  if (
    (tpl.key === "a3_explain_with_buttons" || tpl.key === "a5b_after_club_buttons") &&
    catalog.length > 0
  ) {
    const ovIds = new Set(override.map((b) => b.id));
    const catalogMissingInOverride = catalog.some((b) => !ovIds.has(b.id));
    const staleTitles = override.some(
      (b) =>
        (b.id === "register" && /cadastrar/i.test(b.title)) ||
        (b.id === "activate" && /quero\s*ativar/i.test(b.title)),
    );
    if (catalogMissingInOverride || staleTitles) {
      return catalog;
    }
  }

  const base = override.slice(0, WHAPI_MAX_BUTTONS);
  if (!catalog.length) return base;
  // Override antigo sem destino → preenche pelo template (mesmo id).
  const byId = new Map(catalog.map((b) => [b.id, b]));
  return base.map((b) => {
    if (b.goto_step_key || b.goto_special) return b;
    const def = byId.get(b.id);
    if (!def) return b;
    return {
      ...b,
      goto_step_key: def.goto_step_key ?? null,
      goto_special: def.goto_special ?? null,
    };
  });
}
