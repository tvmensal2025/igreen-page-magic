/**
 * Biblioteca de textos — Conversão Multicanal (Grupo A / Grupo B).
 *
 * Regras Whapi (obrigatórias):
 * - No máximo 3 botões por mensagem interativa (API corta o resto).
 * - Título do botão ≤ 25 caracteres.
 * - Fluxo começa captando o NOME (texto livre, sem botão).
 * - Só depois pergunta faixa da conta com até 3 botões.
 *
 * Áudio WhatsApp e ligação (voz Sofia):
 * - Sempre TTS Sofia (nunca “voz Rafael” no áudio).
 * - Abertura padrão: Sofia = atendente virtual do Rafael, da iGreen Energia.
 *
 * Placeholders: {{nome}}, {{frase_disponibilidade}}, {{abertura_sofia}}
 */

import { mergeApprovedA2Audios } from "@/lib/multichannelApprovedAudios";

/** replaceAll compatível com lib ES2020 do projeto. */
function tplReplace(text: string, needle: string, value: string): string {
  return text.split(needle).join(value);
}

/** Abertura oficial — áudio WA (corpo fixo A2, igual ao salvo no painel/biblioteca). */
export const SOFIA_OPENING =
  "Eu sou a Sofia, assistente virtual do Rafael, gestor da iGreen.";

export const A2_BODY_EXPLAIN = `${SOFIA_OPENING}

Para eu te mostrar o quanto você pode economizar, me diga quanto você está gastando por mês na conta de luz.`;

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

export type CadenceGroup = "A" | "B" | "theme" | "availability";

/** Botão Whapi — title máx. 25 chars (whapi-api.ts). */
export type CadenceButton = {
  id: string;
  title: string;
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
 * Padrão A2 WhatsApp: “Olá, Nome.” no 1º corte; na explicação só o nome de novo.
 * Cache `intro:ola:ptbr2:{norm}` + `intro:nome:ptbr3:{norm}` (PT-BR ancorado). A3 usa SEG_NAME_ONLY.
 */
export const SEG_NAME_ONLY: AudioSegment = {
  id: "name_only",
  kind: "name",
  label: "Só o nome (variável · cache por nome · PT-BR)",
  text: "{{nome}}.",
  reusable: true,
};

/**
 * Passo 2 WhatsApp: “Olá, {Nome}.” (1º corte). Passo 3 usa SEG_NAME_ONLY.
 */
export const SEG_NAME_GREET: AudioSegment = {
  id: "name_greet_ola",
  kind: "name",
  label: "Olá + nome (profissional · cache por nome)",
  text: "Olá, {{nome}}.",
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
      return [];
    case "a5_audio_club_benefits":
    case "a5b_after_club_buttons":
      return ["a5_audio_club_benefits"];
    default:
      return tplKey ? [tplKey] : [];
  }
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
    k === "a3_audio_explain"
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
};

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

/** Após explicação: saber mais (clube) / ativar / humano. */
export const AFTER_EXPLAIN_BUTTONS: CadenceButton[] = [
  { id: "more_benefits", title: "Saber mais benefício" },
  { id: "activate", title: "Quero ativar" },
  { id: "human", title: "Falar com humano" },
];

/** Após áudio do clube: cadastrar / humano (máx. 3). */
export const AFTER_CLUB_BUTTONS: CadenceButton[] = [
  { id: "register", title: "Cadastrar" },
  { id: "human", title: "Falar com humano" },
];

/** Botões iniciais de decisão (antes da explicação). */
export const ACTIVATE_BENEFIT_BUTTONS: CadenceButton[] = [
  { id: "activate", title: "Quero ativar" },
  { id: "human", title: "Falar com humano" },
  { id: "how_it_works", title: "Como funciona" },
];

export function validateWhapiButtons(buttons: CadenceButton[] | undefined): {
  ok: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  if (!buttons || buttons.length === 0) return { ok: true, errors };
  if (buttons.length > WHAPI_MAX_BUTTONS) {
    errors.push(`Máximo ${WHAPI_MAX_BUTTONS} botões Whapi (recebeu ${buttons.length})`);
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

/** Frase dinâmica de disponibilidade (America/Sao_Paulo). */
export function buildAvailabilityPhrase(
  now: Date = new Date(),
): { phrase: string; slot: "before_1630" | "1630_1730" | "after_1730" | "after_1800" | "closed" } {
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

  const closedPhrase =
    "Recebi sua solicitação e deixei seu atendimento preparado. No próximo horário de atendimento, nossa equipe dará continuidade.";

  if (wd === "Sun" || wd === "Sat") {
    return { slot: "closed", phrase: closedPhrase };
  }
  if (mins >= 18 * 60) return { slot: "after_1800", phrase: closedPhrase };
  if (mins >= 17 * 60 + 30) {
    return {
      slot: "after_1730",
      phrase: "Deixei seu atendimento preparado e posso continuar no próximo horário de atendimento.",
    };
  }
  if (mins >= 16 * 60 + 30) {
    return { slot: "1630_1730", phrase: "Ainda estou disponível hoje até as 18 horas." };
  }
  if (mins >= 9 * 60) {
    return { slot: "before_1630", phrase: "Estou disponível hoje até as 18 horas." };
  }
  return { slot: "closed", phrase: closedPhrase };
}

export function renderCadenceBody(
  body: string,
  opts: {
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
  } = {},
): string {
  const nome = (opts.nome || "Cliente").trim() || "Cliente";
  const { phrase } = buildAvailabilityPhrase(opts.now ?? new Date());
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
    ["{{bem_vindo}}", g.bem_vindo],
    ["{{o_a}}", g.o_a],
    ["{{do_da}}", g.do_da],
    ["{{ao_a}}", g.ao_a],
    ["{{querido_a}}", g.querido_a],
  ].reduce((acc, [k, v]) => tplReplace(acc, k, v), body);
}

/**
 * Texto falado de um corte para TTS/cache.
 * - `name` com template “Olá, {{nome}}.” → “Olá, Nome.”
 * - `name` com só “{{nome}}.” → “Nome.” (passo 3: Então é corte fixo à parte)
 * - `name` com “Então, {{nome}}.” → “Então, Nome.” (legado)
 */
export function spokenSegmentText(
  seg: AudioSegment,
  opts: {
    nome?: string;
    gender?: SpeechGender;
    now?: Date;
    valorFormatado?: string;
    economiaMin?: string;
    economiaMax?: string;
  } = {},
): string {
  const first = firstNameOnly(opts.nome || "Cliente");
  if (seg.kind === "name") {
    const raw = (seg.text || "").trim();
    // Só o nome (passo 3): Então fica no corte fixo.
    if (!raw || raw === "{{nome}}" || raw === "{{nome}}." || raw === "{{nome}}!") {
      return `${first}.`;
    }
    return renderCadenceBody(raw, { ...opts, nome: first }).trim();
  }
  return renderCadenceBody(seg.text, { ...opts, nome: first }).trim();
}

export function smsCharCount(body: string): number {
  return renderCadenceBody(body, { nome: "Maria" }).length;
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
    body: "Deixei seu atendimento preparado e posso continuar no próximo horário de atendimento.",
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
      "OBRIGATÓRIO aguardar. Sem botões. Salvar em customer.name. Só depois → passo 2. Texto oficial curto (agilizar).",
    // Evitar `*Olá!* *Para…*` (WhatsApp cola em `*Olá!Para…*` sem espaço).
    body: `*Olá!* Para agilizar seu atendimento, informe seu *primeiro nome*.`,
  },
  {
    key: "a2_audio_activate_name",
    group: "A",
    channel: "whatsapp_audio",
    title: "2a — Áudio: Olá+{{nome}} · Sofia/Rafael",
    timing: "Após nome salvo · antes de pedir valor",
    canGenerateAudio: true,
    notes:
      "2 cortes: 1) Olá+Nome (variável · PT-BR · cache 200+ nomes) 2) corpo FIXO M/F (sem {{nome}} · já gerado no painel). Motor NÃO regenera corpo.",
    audioSegments: [
      {
        ...SEG_NAME_GREET,
        id: "a2_name",
        label: "1 · Olá + nome (único corte variável · PT-BR)",
      },
      {
        id: "a2_body_feminino",
        kind: "fixed",
        genderVariant: "feminino",
        label: "2 · Corpo feminino (fixo · cache · sem nome)",
        text: A2_BODY_EXPLAIN,
      },
      {
        id: "a2_body_masculino",
        kind: "fixed",
        genderVariant: "masculino",
        label: "3 · Corpo masculino (fixo · cache · sem nome)",
        text: A2_BODY_EXPLAIN,
      },
    ],
    body: joinAudioSegmentTexts([
      { text: "Olá, {{nome}}." },
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
    body: `{{nome}}, conseguimos ativar o seu benefício!

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
      "Ordem: 1) áudio Nome+explicação (corpo FIXO) 2) 4s 3) texto economia + botões (Saber mais / Ativar / Humano). Sem Olá de novo.",
    body: `Perfeito, *{{nome}}*!

Com base no valor de *R$ {{valor_conta}}*, hoje você consegue economizar de *8% a 20%* todos os meses — cerca de *{{economia_range}}*.

*O que você prefere agora*?`,
    buttons: [...AFTER_EXPLAIN_BUTTONS],
    audioSegments: [
      {
        ...SEG_NAME_ONLY,
        id: "a3_name",
        label: "1 · Só o nome (variável · PT-BR · cache por nome)",
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
        ...SEG_NAME_ONLY,
        id: "a3_name",
        label: "1 · Só o nome (variável · cache por nome)",
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
      { text: "{{nome}}." },
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
    title: "4a — Áudio clube (nome + benefício)",
    timing: "Após Saber mais benefício · áudio → 4s → 4b",
    canGenerateAudio: true,
    notes:
      "2 cortes: 1) só o Nome (PT-BR) 2) corpo FIXO do clube/benefício (sem {{nome}}). Ordem: áudio ACIMA → 4b.",
    audioSegments: [
      {
        ...SEG_NAME_ONLY,
        id: "a5_name",
        label: "1 · Só o nome (variável · PT-BR · cache por nome)",
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
      { text: "{{nome}}." },
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
    title: "4b — Texto + Cadastrar / Falar com humano",
    timing: "4s após áudio 4a · AGUARDA clique",
    canGenerateAudio: false,
    pairedAudioKey: "a5_audio_club_benefits",
    notes:
      "Nunca pular. Ordem: áudio 4a → 4s → este texto + botões. Cadastrar → passo 5 (foto conta). Humano → handoff.",
    body: `📋 *{{nome}}*, vamos ativar seu benefício?

Toque em *Cadastrar* para continuar 👇`,
    buttons: [...AFTER_CLUB_BUTTONS],
  },
  {
    key: "a6_ask_bill_photo",
    group: "A",
    channel: "whatsapp_text",
    title: "5 — Pedir foto da conta (OCR)",
    timing: "Após Cadastrar ou Quero ativar",
    canGenerateAudio: false,
    body: `✅ *Perfeito, {{nome}}!*

📸 *Agora me envie a foto da sua conta de luz*

• Página com o *valor* e os *dados da unidade*
• Foto *nítida*, sem reflexos
• Pode ser a fatura mais recente

Assim valido tudo automaticamente e seguimos com a ativação 💚`,
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
    body: `📄 *Próximo passo, {{nome}}!*

Me envie a foto do seu *documento com foto*:

🪪 *CNH* → só a *frente*

🆔 *RG* → *frente e verso* (obrigatório)

Preciso das fotos *nítidas* para continuar seu cadastro ✅`,
  },
  {
    key: "a8_ask_email",
    group: "A",
    channel: "whatsapp_text",
    title: "7 — Pedir e-mail",
    timing: "Após documento",
    canGenerateAudio: false,
    notes: "Mesmo padrão do fluxo D (ask_email / step-goal): e-mail = acesso ao app iGreen Club.",
    body: `📧 *{{nome}}*, qual é o seu *e-mail*?

É por ele que você acessa o app *iGreen Club* 📱

_(cashback, faturas e indicações)_`,
  },
  {
    key: "a9_confirm_phone",
    group: "A",
    channel: "whatsapp_buttons",
    title: "8 — Confirmar telefone",
    timing: "Após e-mail · depois → 9 OTP → 10 facial",
    canGenerateAudio: false,
    notes:
      "Após telefone: passo 9 (portal + digitar OTP). Só DEPOIS do OTP validado → passo 10 (link da facial). Sem 9a/9b.",
    body: `📱 *{{nome}}*, só confirmar:

O telefone deste WhatsApp é o melhor para contato?

*Número:* {{telefone}}`,
    buttons: [
      { id: "phone_ok", title: "Sim, este número" },
      { id: "phone_other", title: "Quero outro" },
      { id: "human", title: "Falar com humano" },
    ],
  },
  {
    key: "a10_portal_otp_facial",
    group: "A",
    channel: "whatsapp_text",
    title: "9 — Portal + digitar OTP",
    timing: "Após telefone confirmado · AGUARDA o código OTP",
    canGenerateAudio: false,
    notes:
      "Ordem obrigatória: 1) envia cadastro ao portal 2) cliente digita o OTP aqui 3) só então passo 10 com link da facial. NÃO enviar facial neste passo.",
    body: `🎉 *Pronto, {{nome}}!*

Já temos todos os dados ✅

Vou enviar seu cadastro ao portal agora.

📲 Em seguida você recebe um *código OTP* — digite aqui no WhatsApp 👇

_(O link da validação facial só vem *depois* do OTP correto.)_`,
  },
  {
    key: "a11_facial_link",
    group: "A",
    channel: "whatsapp_text",
    title: "10 — Link da facial (após OTP)",
    timing: "Só depois do OTP validado",
    canGenerateAudio: false,
    notes:
      "Nunca antes do OTP. Sistema envia o link da selfie/facial após otp_validated. Placeholder {{link_facial}} quando disponível.",
    body: `✅ *OTP confirmado, {{nome}}!*

Último passo — abra o *link* 👇

{{link_facial}}

Toque em *Assinar documentos* e faça a *validação facial* para comprovar que é você 🪪`,
  },
  {
    key: "a10_title_transfer_sp",
    group: "A",
    channel: "whatsapp_buttons",
    title: "9a — Transferência de título SP (legado · fora do fluxo)",
    timing: "NÃO usar — após telefone → OTP → facial",
    canGenerateAudio: false,
    hiddenInPanel: true,
    notes:
      "Legado. Fluxo atual: telefone → OTP (9) → facial (10). Mantido só por compatibilidade.",
    body: `{{nome}}, em São Paulo, para concluir a ativação, pode ser necessária a transferência de titularidade da conta, conforme as regras da distribuidora.

Nossa equipe orienta o passo a passo — sem custo de ativação cobrado por consultor.

Vamos seguir com essa etapa, {{nome}}?`,
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
    timing: "NÃO usar — após telefone → OTP → facial",
    canGenerateAudio: false,
    hiddenInPanel: true,
    notes:
      "Legado. Fluxo atual: telefone → OTP (9) → facial (10). Mantido só por compatibilidade.",
    body: `{{nome}}, vamos seguir com o seu cadastro para ativar o benefício.

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
    body: `Combinado, {{nome}}.

Vou transferir você para um atendente da equipe do Rafael. Em instantes alguém assume a conversa por aqui.`,
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
    body: `Sofia | iGreen: oi {{nome}}, deixei seu atendimento no WhatsApp para ativar o beneficio. Qualquer duvida e so responder.`,
  },
  {
    key: "a_optional_call_slot",
    group: "A",
    channel: "call_script",
    title: "Opcional — Ligação Sofia (encaixe no construtor)",
    timing: "Consultor escolhe o momento no fluxo",
    canGenerateAudio: true,
    notes: "Passo make_call — opcional. Nome isolado (cache) · abertura fixa.",
    audioSegments: [
      { ...SEG_NAME_GREET, label: "1 · Olá + nome (único corte variável)" },
      {
        id: "call_body",
        kind: "fixed",
        label: "2 · Corpo do áudio (fixo · cache)",
        text: `Eu sou a Sofia, assistente virtual do Rafael Ferreira Dias, da iGreen Energia.

Estou ligando sobre a ativação do seu benefício de economia na conta de energia.

Você prefere continuar pelo WhatsApp ou prefere que eu explique agora em 30 segundos?`,
      },
    ],
    body: joinAudioSegmentTexts([
      { text: "Olá, {{nome}}." },
      {
        text: `Eu sou a Sofia, assistente virtual do Rafael Ferreira Dias, da iGreen Energia.

Estou ligando sobre a ativação do seu benefício de economia na conta de energia.

Você prefere continuar pelo WhatsApp ou prefere que eu explique agora em 30 segundos?`,
      },
    ]),

  },

  // ─── GRUPO B (lead já está no CRM — já mandou mensagem antes) ───────────
  {
    key: "b0_ask_name",
    group: "B",
    channel: "whatsapp_text",
    title: "1 — Pedir o nome (só se faltar no CRM)",
    timing: "Dia 0 · no começo · só se o nome estiver faltando ou inválido",
    canGenerateAudio: false,
    notes:
      "O lead já está no CRM (já mandou mensagem). Se o nome já estiver certo, pula esta etapa e vai direto para a reabertura. Sem botões — o cliente digita o nome.",
    body: `Olá! Tudo bem?

Aqui é o Rafael Ferreira Dias, da iGreen.

Estou reabrindo um atendimento sobre economia na conta de energia.

Para continuar, me diga seu primeiro nome, por favor.`,
  },
  {
    key: "b1_wa_reopen",
    group: "B",
    channel: "whatsapp_buttons",
    title: "2 — Reabrir atendimento (perguntar faixa da conta)",
    timing: "Dia 0 · envia às 09h30",
    canGenerateAudio: false,
    notes:
      "WhatsApp com 3 botões de faixa. Usa o nome que já está no CRM. Se precisar de foto/ligar/encerrar, segue o passo seguinte.",
    body: `Olá, {{nome}}, tudo bem?

Aqui é o Rafael Ferreira Dias.

Estou reabrindo seu atendimento porque você já havia demonstrado interesse em reduzir sua conta de energia e surgiram novidades na forma de iniciar a análise.

Agora conseguimos começar usando apenas o valor médio da conta.

{{frase_disponibilidade}}

Sua conta fica em qual faixa?

Para não receber novos contatos, responda SAIR.`,
    buttons: [...BILL_RANGE_BUTTONS],
  },
  {
    key: "b1_wa_reopen_b3",
    group: "B",
    channel: "whatsapp_buttons",
    title: "2 — Reabrir lead parado há mais tempo",
    timing: "Dia 0 · envia às 09h30",
    canGenerateAudio: false,
    notes:
      "Versão para quem pediu informação há bastante tempo. Não diga que há atendimento pendente se não houver histórico.",
    body: `Olá, {{nome}}, tudo bem?

Aqui é o Rafael Ferreira Dias.

Há algum tempo você pediu informações sobre economia na conta de energia e surgiram novidades na forma de iniciar a análise.

Agora conseguimos começar usando apenas o valor médio da conta.

{{frase_disponibilidade}}

Sua conta fica em qual faixa?

Para não receber novos contatos, responda SAIR.`,
    buttons: [...BILL_RANGE_BUTTONS],
  },
  {
    key: "b1b_wa_next_action",
    group: "B",
    channel: "whatsapp_buttons",
    title: "2b — Outras opções (foto, ligar ou encerrar)",
    timing: "Dia 0 · depois das 09h30 · só se precisar",
    canGenerateAudio: false,
    notes: "Oferece continuar de outro jeito: enviar foto, pedir ligação ou encerrar.",
    body: `{{nome}}, prefere continuar de outro jeito?`,
    buttons: [...NEXT_ACTION_BUTTONS],
  },
  {
    key: "b2_wa_audio",
    group: "B",
    channel: "whatsapp_audio",
    title: "3 — Áudio de reativação (Sofia · ~30s)",
    timing: "Dia 0 · envia às 09h32 · só com nome no CRM",
    canGenerateAudio: true,
    notes: "Sempre voz Sofia. Abertura fixa; o nome entra só no cumprimento.",
    audioSegments: [
      { ...SEG_NAME_GREET, label: "1 · Olá + nome (único corte variável)" },
      {
        id: "b2_body",
        kind: "fixed",
        label: "2 · Corpo do áudio (fixo · cache)",
        text: `Eu sou a Sofia, assistente virtual do Rafael Ferreira Dias, da iGreen Energia.

Estou entrando em contato porque você já pediu informações sobre economia na conta de energia e queremos apresentar uma forma mais simples de retomar sua análise com o Rafael.

Agora conseguimos começar apenas pelo valor médio da sua conta.

{{frase_disponibilidade}}

Não existe pagamento ao consultor, Pix ou depósito para iniciar a análise. Responda por aqui com o valor aproximado que o Rafael acompanha você.`,
      },
    ],
    body: joinAudioSegmentTexts([
      { text: "Olá, {{nome}}." },
      { text: `Eu sou a Sofia, assistente virtual do Rafael Ferreira Dias, da iGreen Energia.

Estou entrando em contato porque você já pediu informações sobre economia na conta de energia e queremos apresentar uma forma mais simples de retomar sua análise com o Rafael.

Agora conseguimos começar apenas pelo valor médio da sua conta.

{{frase_disponibilidade}}

Não existe pagamento ao consultor, Pix ou depósito para iniciar a análise. Responda por aqui com o valor aproximado que o Rafael acompanha você.` },
    ]),

  },
  {
    key: "b3_sms_1",
    group: "B",
    channel: "sms",
    title: "4 — Primeiro SMS",
    timing: "Dia 0 · envia às 11h30",
    canGenerateAudio: false,
    maxChars: 160,
    body: `Rafael | iGreen: {{nome}}, reabri sua análise de economia. Deixei as infos no WhatsApp. Para sair, responda SAIR.`,
  },
  {
    key: "b4_call_1",
    group: "B",
    channel: "call_script",
    title: "5 — Primeira ligação (Sofia)",
    timing: "Dia 0 · entre 15h e 17h",
    canGenerateAudio: true,
    audioSegments: [
      { ...SEG_NAME_GREET, label: "1 · Olá + nome (único corte variável)" },
      {
        id: "b4_body",
        kind: "fixed",
        label: "2 · Corpo do áudio (fixo · cache)",
        text: `Eu sou a Sofia, assistente virtual do Rafael Ferreira Dias, da iGreen Energia.

Você já havia demonstrado interesse em reduzir sua conta de energia e estamos revisando atendimentos que não foram concluídos. Agora conseguimos iniciar a análise usando apenas o valor médio da conta. Você prefere informar o valor agora ou receber a explicação pelo WhatsApp?

Se demonstrar desconfiança: Entendo perfeitamente. Por isso reforço que não pedimos Pix, depósito ou pagamento ao consultor para iniciar a análise.

Se estiver ocupado: Sem problema. Fica melhor retornarmos hoje antes das 18 horas ou amanhã pela manhã?`,
      },
    ],
    body: joinAudioSegmentTexts([
      { text: "Olá, {{nome}}." },
      { text: `Eu sou a Sofia, assistente virtual do Rafael Ferreira Dias, da iGreen Energia.

Você já havia demonstrado interesse em reduzir sua conta de energia e estamos revisando atendimentos que não foram concluídos. Agora conseguimos iniciar a análise usando apenas o valor médio da conta. Você prefere informar o valor agora ou receber a explicação pelo WhatsApp?

Se demonstrar desconfiança: Entendo perfeitamente. Por isso reforço que não pedimos Pix, depósito ou pagamento ao consultor para iniciar a análise.

Se estiver ocupado: Sem problema. Fica melhor retornarmos hoje antes das 18 horas ou amanhã pela manhã?` },
    ]),

  },
  {
    key: "b_day2_wa",
    group: "B",
    channel: "whatsapp_buttons",
    title: "Dia 2 — Segunda novidade no WhatsApp",
    timing: "Dia 2 · envia às 10h30",
    canGenerateAudio: false,
    notes:
      "O sistema escolhe um tema diferente do Dia 0. Sem áudio. Até 3 botões de faixa.",
    body: `{{tema_whatsapp}}`,
    buttons: [...BILL_RANGE_BUTTONS],
  },
  {
    key: "b_day4_call_2",
    group: "B",
    channel: "call_script",
    title: "Dia 4 — Segunda ligação (Sofia)",
    timing: "Dia 4 · entre 14h30 e 17h",
    canGenerateAudio: true,
    audioSegments: [
      { ...SEG_NAME_GREET, label: "1 · Olá + nome (único corte variável)" },
      {
        id: "d4_body",
        kind: "fixed",
        label: "2 · Corpo do áudio (fixo · cache)",
        text: `Eu sou a Sofia, assistente virtual do Rafael Ferreira Dias, da iGreen Energia.

Estou retornando porque enviamos uma atualização diferente das informações que você recebeu anteriormente. Você prefere que eu explique rapidamente agora ou que eu deixe tudo organizado no WhatsApp para o Rafael?

Se estiver ocupado: Sem problema. Qual melhor dia e horário para retornarmos?`,
      },
    ],
    body: joinAudioSegmentTexts([
      { text: "Olá, {{nome}}." },
      { text: `Eu sou a Sofia, assistente virtual do Rafael Ferreira Dias, da iGreen Energia.

Estou retornando porque enviamos uma atualização diferente das informações que você recebeu anteriormente. Você prefere que eu explique rapidamente agora ou que eu deixe tudo organizado no WhatsApp para o Rafael?

Se estiver ocupado: Sem problema. Qual melhor dia e horário para retornarmos?` },
    ]),

  },
  {
    key: "b_day6_sms_2",
    group: "B",
    channel: "sms",
    title: "Dia 6 — Segundo SMS",
    timing: "Dia 6 · envia às 11h30",
    canGenerateAudio: false,
    maxChars: 160,
    body: `Rafael | iGreen: {{nome}}, além da economia há novas infos e benefícios. Veja o WhatsApp. SAIR encerra.`,
  },
  {
    key: "b_day7_wa_easy",
    group: "B",
    channel: "whatsapp_buttons",
    title: "Dia 7 — Resposta fácil (faixa da conta)",
    timing: "Dia 7 · envia às 10h30",
    canGenerateAudio: false,
    notes:
      "3 botões de faixa. Se precisar de foto, ligação ou encerrar, usa o passo seguinte.",
    body: `Olá, {{nome}}.

Para verificar seu caso, não precisa escrever uma mensagem grande.

Qual faixa da sua conta?`,
    buttons: [...BILL_RANGE_BUTTONS],
  },
  {
    key: "b_day7b_wa_action",
    group: "B",
    channel: "whatsapp_buttons",
    title: "Dia 7 — Outras opções (foto, ligar ou encerrar)",
    timing: "Dia 7 · depois das 10h30 · só se precisar",
    canGenerateAudio: false,
    body: `{{nome}}, ou prefere outra opção?`,
    buttons: [...NEXT_ACTION_BUTTONS],
  },
  {
    key: "b_day10_call",
    group: "B",
    channel: "call_script",
    title: "Dia 10 — Ligação final (Sofia)",
    timing: "Dia 10 · envia às 15h",
    canGenerateAudio: true,
    audioSegments: [
      { ...SEG_NAME_GREET, label: "1 · Olá + nome (único corte variável)" },
      {
        id: "d10_body",
        kind: "fixed",
        label: "2 · Corpo do áudio (fixo · cache)",
        text: `Eu sou a Sofia, assistente virtual do Rafael Ferreira Dias, da iGreen Energia.

Estou concluindo esta sequência de atendimento para não ficar insistindo. Você prefere manter sua análise disponível com o Rafael ou encerrar o atendimento? Para iniciar, precisamos apenas do valor médio ou de uma foto da conta.`,
      },
    ],
    body: joinAudioSegmentTexts([
      { text: "Olá, {{nome}}." },
      { text: `Eu sou a Sofia, assistente virtual do Rafael Ferreira Dias, da iGreen Energia.

Estou concluindo esta sequência de atendimento para não ficar insistindo. Você prefere manter sua análise disponível com o Rafael ou encerrar o atendimento? Para iniciar, precisamos apenas do valor médio ou de uma foto da conta.` },
    ]),

  },
  {
    key: "b_day10_wa_final",
    group: "B",
    channel: "whatsapp_buttons",
    title: "Dia 10 — WhatsApp final (pausar atendimento)",
    timing: "Dia 10 · depois da ligação · se não atender",
    canGenerateAudio: false,
    notes: "Depois disso o atendimento fica pausado e só volta a ser contactado após 21 dias.",
    body: `Olá, {{nome}}.

Como não consegui falar com você, vou pausar este atendimento.

Quando quiser retomar, use uma opção abaixo ou responda SAIR para não receber novos contatos.`,
    buttons: [
      { id: "analyze", title: "ANALISAR" },
      { id: "call_me", title: "Pode me ligar" },
      { id: "stop", title: "Encerrar" },
    ],
  },

  // ─── TEMAS (todos ≤ 3 botões) ───────────────────────────────────────────
  {
    key: "theme_simplified_analysis_wa",
    group: "theme",
    channel: "whatsapp_buttons",
    title: "Tema — Análise simplificada",
    timing: "Alternável",
    theme: "simplified_analysis",
    canGenerateAudio: false,
    body: `Olá, {{nome}}.

Voltei ao seu atendimento porque agora conseguimos iniciar a análise de forma mais simples, só com o valor médio.

{{frase_disponibilidade}}

Qual faixa da sua conta?`,
    buttons: [...BILL_RANGE_BUTTONS],
  },
  {
    key: "theme_simplified_analysis_sms",
    group: "theme",
    channel: "sms",
    title: "Tema — Análise simplificada (SMS)",
    timing: "Alternável",
    theme: "simplified_analysis",
    canGenerateAudio: false,
    maxChars: 160,
    body: `Rafael | Energia: {{nome}}, sua análise pode começar pelo valor médio. Veja o WhatsApp. SAIR encerra.`,
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
    notes: "3 botões: economia / regras / ligar. Não afirmar “você ganhou”.",
    body: `Olá, {{nome}}! Você sabia dessa novidade?

Além da economia na conta de energia, clientes elegíveis podem participar de um sorteio de uma cabine de cruzeiro para duas pessoas, conforme o regulamento vigente.

{{frase_disponibilidade}}

O que você quer conhecer primeiro?`,
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
    body: `Conforme o regulamento vigente, o pagamento antecipado pode gerar uma participação adicional.`,
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
      { ...SEG_NAME_GREET, label: "1 · Olá + nome (único corte variável)" },
      {
        id: "cruise_body",
        kind: "fixed",
        label: "2 · Corpo do áudio (fixo · cache)",
        text: `Eu sou a Sofia, assistente virtual do Rafael Ferreira Dias, da iGreen Energia.

Além da possibilidade de economia na conta de energia, existe uma novidade especial: clientes elegíveis podem participar de um sorteio de uma cabine de cruzeiro para duas pessoas, conforme o regulamento. Responda por aqui que eu explico as regras e também verifico sua análise de economia com o Rafael.`,
      },
    ],
    body: joinAudioSegmentTexts([
      { text: "Olá, {{nome}}." },
      { text: `Eu sou a Sofia, assistente virtual do Rafael Ferreira Dias, da iGreen Energia.

Além da possibilidade de economia na conta de energia, existe uma novidade especial: clientes elegíveis podem participar de um sorteio de uma cabine de cruzeiro para duas pessoas, conforme o regulamento. Responda por aqui que eu explico as regras e também verifico sua análise de economia com o Rafael.` },
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
    body: `Rafael | iGreen: novidade elegível: sorteio cabine cruzeiro p/ 2, conforme regulamento. Veja WhatsApp. SAIR encerra.`,
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
    body: `Olá, {{nome}}.

As bandeiras amarela e vermelha podem aumentar o valor final da conta.

O benefício de economia pode ajudar a reduzir o impacto desses aumentos, conforme o consumo e as condições aplicáveis.

Quer análise inicial pelo valor médio? Qual faixa?`,
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
    body: `Rafael | Energia: bandeiras podem aumentar a conta. Veja no WhatsApp como analisar. SAIR encerra.`,
  },
  {
    key: "theme_no_home_panels_wa",
    group: "theme",
    channel: "whatsapp_buttons",
    title: "Tema — Sem placas / sem obra",
    timing: "Alternável",
    theme: "no_home_panels",
    canGenerateAudio: false,
    body: `Olá, {{nome}}.

Para conhecer essa possibilidade de economia, não é necessário instalar placas solares na sua casa, fazer obra ou alterar sua instalação.

A análise pode começar pelo valor médio. Como prefere?`,
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
    body: `Rafael | Energia: a análise não exige placas em casa nem obra. Veja o WhatsApp. SAIR encerra.`,
  },
  {
    key: "theme_security_wa",
    group: "theme",
    channel: "whatsapp_buttons",
    title: "Tema — Segurança",
    timing: "Alternável",
    theme: "security",
    canGenerateAudio: false,
    body: `Olá, {{nome}}. Aqui é o Rafael.

Reforço: não pedimos Pix, depósito ou pagamento ao consultor para iniciar a análise.

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
    body: `Rafael | iGreen: não pedimos Pix ou pagamento ao consultor. Veja o WhatsApp. SAIR encerra.`,
  },
  {
    key: "theme_benefits_club_wa",
    group: "theme",
    channel: "whatsapp_buttons",
    title: "Tema — Clube de benefícios",
    timing: "Alternável · números só de config",
    theme: "benefits_club",
    canGenerateAudio: false,
    body: `Olá, {{nome}}.

O benefício não termina na economia da conta: clientes elegíveis podem ter vantagens em estabelecimentos parceiros, conforme condições vigentes.

O que você quer conhecer?`,
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
    body: `Rafael | iGreen: além da economia, há benefícios em parceiros. Veja o WhatsApp. SAIR encerra.`,
  },
  {
    key: "theme_referral_cashback_wa",
    group: "theme",
    channel: "whatsapp_buttons",
    title: "Tema — Indicação / cashback",
    timing: "Alternável · valor só de config",
    theme: "referral_cashback",
    canGenerateAudio: false,
    body: `Olá, {{nome}}.

Além da própria economia, também podem existir benefícios por indicação, conforme as regras vigentes.

O que você quer conhecer?`,
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
    body: `Rafael | iGreen: além da economia, há benefícios de indicação (regras vigentes). Veja WhatsApp. SAIR encerra.`,
  },
  {
    key: "theme_digital_app_wa",
    group: "theme",
    channel: "whatsapp_buttons",
    title: "Tema — App digital",
    timing: "Alternável",
    theme: "digital_app",
    canGenerateAudio: false,
    body: `Olá, {{nome}}.

Além da economia na conta, clientes elegíveis podem acompanhar o benefício pelo aplicativo, conforme as condições vigentes.

{{frase_disponibilidade}}

Como prefere seguir?`,
    buttons: [...ANALYZE_OR_CALL_BUTTONS],
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
    return savedOk ? saved : tpl.body;
  }
  const segs = resolveAudioSegments(tpl, lib);
  if (segs.length) return joinAudioSegmentTexts(segs);
  return savedOk ? saved : tpl.body;
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
  if (override) return override.slice(0, WHAPI_MAX_BUTTONS);
  return (tpl.buttons ?? []).slice(0, WHAPI_MAX_BUTTONS);
}
