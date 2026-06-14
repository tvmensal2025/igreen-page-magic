import { useMemo } from "react";
import { Step, getButtons, isOcrStep, isAiAnswerStep } from "./flowTypes";


export type FlowWarning = {
  id: string;                       // chave única estável (stepId + tipo + alvo)
  stepId: string;
  level: "error" | "warn" | "info";
  kind:
    | "transition_no_dest"
    | "transition_dest_missing"
    | "transition_dest_inactive"
    | "button_no_rule"
    | "orphan_step"
    | "loop_detected"
    | "unresolved_var"
    | "empty_message"
    | "ocr_without_confirm"
    | "ai_no_buttons"
    | "ai_no_humano_exit"
    | "conversion_step_no_cta"
    | "goto_no_wait"
    | "var_before_capture"
    | "media_missing"
    | "flow_no_ending"
    | "too_many_buttons";
  message: string;


  /** Sugestão de correção automática (se aplicável). */
  autoFix?: () => Partial<Step> | null;
};

// Conjunto CANÔNICO de variáveis (nomes "oficiais"). Usado na lógica de ordem
// de captura (`var_before_capture`), que cruza a variável usada no texto com o
// passo que a PRODUZ (`VAR_PRODUCERS`). Mantém-se enxuto de propósito: incluir
// sinônimos aqui faria a checagem de ordem perder a correspondência 1:1 com os
// produtores e gerar falso positivo (ex.: {{valor}} não casaria com
// capture_conta, que produz "valor_conta").
const KNOWN_VARS = new Set([
  "nome", "valor_conta", "economia_range", "telefone", "cpf", "representante", "email",
]);

// Conjunto AMPLO de variáveis reconhecidas pelo runtime (`render-vars.ts`).
// Usado SOMENTE para o aviso "variável desconhecida": tudo que o runtime sabe
// resolver (chaves canônicas + sinônimos tolerados) NÃO deve alarmar o
// consultor. Espelha NAME_KEYS/PHONE_KEYS/CPF_KEYS/REP_KEYS/BILL_KEYS e as
// chaves de economia de `supabase/functions/_shared/render-vars.ts`. Se o
// runtime ganhar uma nova chave, adicione-a aqui também (os dois precisam andar
// juntos — ver scripts/audit-flow-corrections.py, que vigia essa paridade).
const RECOGNIZED_VARS = new Set([
  // nome e sinônimos
  "nome", "nome_completo", "name", "first_name", "primeiro_nome", "cliente",
  // telefone e sinônimos
  "telefone", "phone", "celular", "whatsapp", "numero", "número",
  // cpf e sinônimos
  "cpf", "documento", "doc",
  // representante e sinônimos
  "representante", "consultor", "consultora", "atendente", "vendedor", "vendedora",
  // valor da conta e sinônimos
  "valor_conta", "valor", "conta", "fatura",
  // economia (derivadas do valor da conta)
  "economia_mensal", "economia_anual", "economia_range", "economia_faixa",
  // e-mail
  "email",
]);

/** Rótulo amigável (pt-BR) de cada variável, para mensagens sem jargão. */
function labelVar(v: string): string {
  const map: Record<string, string> = {
    valor_conta: "valor da conta de luz",
    economia_range: "economia estimada",
    economia_mensal: "economia mensal",
    economia_anual: "economia anual",
    economia_faixa: "economia estimada",
    telefone: "telefone",
    cpf: "CPF",
    email: "e-mail",
    nome: "nome",
    representante: "representante",
  };
  return map[v] ?? v;
}

/** Contadores de mídia por slot (vindos do construtor). */
export type MediaCountsMap = Record<string, { audio: number; image: number; video: number }>;

export type FlowValidation = {
  warnings: FlowWarning[];
  byStep: Record<string, FlowWarning[]>;
  total: number;
  errors: number;
  /** Tenta auto-corrigir todos os warnings que têm autoFix. Retorna o array de patches por stepId. */
  autoFixablePatches: { stepId: string; patch: Partial<Step> }[];
};

/** Detecta ciclos no grafo de transitions. Retorna pares [from, to] que formam ciclos. */
function detectCycles(steps: Step[]): Array<{ fromId: string; toId: string }> {
  const cycles: Array<{ fromId: string; toId: string }> = [];
  const visited = new Set<string>();
  const inStack = new Set<string>();

  const stepMap = new Map(steps.map((s) => [s.id, s]));

  function dfs(id: string, path: string[]): void {
    if (inStack.has(id)) {
      // Encontrou ciclo — registra a aresta que fecha o ciclo
      const cycleStart = path.indexOf(id);
      if (cycleStart >= 0) {
        cycles.push({ fromId: path[path.length - 1], toId: id });
      }
      return;
    }
    if (visited.has(id)) return;
    visited.add(id);
    inStack.add(id);

    const step = stepMap.get(id);
    if (step) {
      for (const t of step.transitions) {
        if (t.goto_step_id) dfs(t.goto_step_id, [...path, id]);
      }
      if (step.fallback?.mode === "goto" && step.fallback.goto_step_id) {
        dfs(step.fallback.goto_step_id, [...path, id]);
      }
    }

    inStack.delete(id);
  }

  for (const s of steps) {
    if (!visited.has(s.id)) dfs(s.id, []);
  }
  return cycles;
}

export function useFlowValidation(steps: Step[], mediaCounts?: MediaCountsMap): FlowValidation {
  return useMemo(() => {
    const warnings: FlowWarning[] = [];
    const reachable = new Set<string>();

    // Marca primeiro passo + qualquer passo destino de transition como alcançável
    if (steps.length) reachable.add(steps[0].id);
    for (const s of steps) {
      for (const t of s.transitions) {
        if (t.goto_step_id) reachable.add(t.goto_step_id);
      }
      // fallback goto também conta como alcançável
      if (s.fallback?.mode === "goto" && s.fallback.goto_step_id) {
        reachable.add(s.fallback.goto_step_id);
      }
      // Passos sequenciais (sem transitions) seguem por position — todos alcançáveis a partir do anterior.
      if (s.transitions.length === 0) {
        const next = steps.find((x) => x.position === s.position + 1);
        if (next) reachable.add(next.id);
      }
    }

    // Detecta ciclos (loops A → B → A)
    const cycles = detectCycles(steps);
    const cycleEdges = new Set(cycles.map((c) => `${c.fromId}→${c.toId}`));
    for (const { fromId, toId } of cycles) {
      const fromStep = steps.find((s) => s.id === fromId);
      const toStep = steps.find((s) => s.id === toId);
      if (fromStep && toStep) {
        warnings.push({
          id: `${fromId}:loop:${toId}`,
          stepId: fromId,
          level: "warn",
          kind: "loop_detected",
          message: `Loop detectado: "${fromStep.title}" → "${toStep.title}" → volta para cá. Pode travar o lead.`,
        });
      }
    }

    for (const s of steps) {
      // mensagem vazia em passo do tipo "message"
      if (s.step_type === "message" && s.is_active && !(s.message_text ?? "").trim()) {
        warnings.push({
          id: `${s.id}:empty_message`,
          stepId: s.id,
          level: "warn",
          kind: "empty_message",
          message: "Passo sem texto de mensagem",
        });
      }

      // variáveis desconhecidas
      const text = s.message_text ?? "";
      const matches = text.match(/\{\{([a-z0-9_]+)\}\}/gi) || [];
      for (const m of matches) {
        const name = m.slice(2, -2).toLowerCase();
        if (!RECOGNIZED_VARS.has(name)) {
          warnings.push({
            id: `${s.id}:unresolved_var:${name}`,
            stepId: s.id,
            level: "warn",
            kind: "unresolved_var",
            message: `Variável desconhecida {{${name}}}`,
          });
        }
      }

      // transitions
      for (const [idx, t] of s.transitions.entries()) {
        const label = t.trigger_phrases[0] || t.trigger_intent || `regra #${idx + 1}`;
        if (!t.goto_step_id && !t.goto_special) {
          warnings.push({
            id: `${s.id}:transition_no_dest:${idx}`,
            stepId: s.id,
            level: "error",
            kind: "transition_no_dest",
            message: `Regra "${label}" sem destino`,
            autoFix: () => {
              // remove transition órfã
              const next = s.transitions.filter((_, i) => i !== idx);
              return { transitions: next };
            },
          });
          continue;
        }
        if (t.goto_step_id) {
          const dst = steps.find((x) => x.id === t.goto_step_id);
          if (!dst) {
            warnings.push({
              id: `${s.id}:transition_dest_missing:${idx}`,
              stepId: s.id,
              level: "error",
              kind: "transition_dest_missing",
              message: `Regra "${label}" aponta para passo removido`,
              autoFix: () => {
                const next = s.transitions.filter((_, i) => i !== idx);
                return { transitions: next };
              },
            });
          } else if (!dst.is_active) {
            warnings.push({
              id: `${s.id}:transition_dest_inactive:${idx}`,
              stepId: s.id,
              level: "warn",
              kind: "transition_dest_inactive",
              message: `Regra "${label}" aponta para "${dst.title}" (inativo)`,
            });
          }
        }
      }

      // botões sem regra de destino
      const buttons = getButtons(s);
      for (const b of buttons) {
        const hasRule = s.transitions.some(
          (t) =>
            t.trigger_intent === b.id ||
            t.trigger_phrases.includes(b.title) ||
            t.trigger_phrases.includes(b.id),
        );
        if (!hasRule) {
          warnings.push({
            id: `${s.id}:button_no_rule:${b.id}`,
            stepId: s.id,
            level: "warn",
            kind: "button_no_rule",
            message: `Botão "${b.title}" sem regra de destino`,
          });
        }
      }

      // passo órfão (ativo, mas ninguém aponta pra ele e não está em sequência)
      if (s.is_active && !reachable.has(s.id) && steps.length > 1) {
        warnings.push({
          id: `${s.id}:orphan_step`,
          stepId: s.id,
          level: "info",
          kind: "orphan_step",
          message: "Nenhum passo leva até aqui",
        });
      }

      // OCR sem passo de confirmação logo depois

      if (isOcrStep(s) && s.auto_detect_doc_type !== false) {
        const next = steps
          .filter((x) => x.position > s.position && x.is_active)
          .sort((a, b) => a.position - b.position)[0];
        const isConfirm =
          !!next &&
          (/(confirm|conferir|revisar)/i.test(next.step_key ?? "") ||
            /(está tudo certo|confirma os dados|tudo certo)/i.test(next.message_text ?? ""));
        if (!isConfirm) {
          warnings.push({
            id: `${s.id}:ocr_without_confirm`,
            stepId: s.id,
            level: "warn",
            kind: "ocr_without_confirm",
            message:
              "OCR ativo, mas não há passo de confirmação logo depois. Aplique o template \"Confirmação pós-OCR\".",
          });
        }
      }

      // Passos "IA livre" — precisam de botões pra lead sair do loop
      if (isAiAnswerStep(s) && s.is_active) {
        const btns = getButtons(s);
        if (btns.length === 0) {
          warnings.push({
            id: `${s.id}:ai_no_buttons`,
            stepId: s.id,
            level: "error",
            kind: "ai_no_buttons",
            message: "Passo de IA livre sem botões — lead fica em loop infinito. Adicione 'Quero simular' e 'Falar com humano'.",
          });
        } else {
          const hasHumano = s.transitions.some((t) => t.goto_special === "humano");
          if (!hasHumano) {
            warnings.push({
              id: `${s.id}:ai_no_humano_exit`,
              stepId: s.id,
              level: "warn",
              kind: "ai_no_humano_exit",
              message: "Adicione um botão 'Falar com humano' como saída de emergência.",
            });
          }
        }
      }

      // Passos de SIMULAÇÃO/CONVERSÃO entre OCR e captura de documento.
      // Detecta passos `message` ativos que vêm DEPOIS de capture_conta e
      // ANTES de capture_documento/finalizar_cadastro. Esses passos são
      // CTAs cruciais (mostrar economia, pitch de fechamento) e precisam
      // de botões para o cliente decidir prosseguir. Sem botões, o lead
      // recebe a simulação e não sabe o que fazer — taxa de conversão cai.
      if (s.step_type === "message" && s.is_active) {
        const captureContaPos = steps
          .find((x) => x.step_type === "capture_conta" && x.is_active)?.position;
        const captureDocOrFinalPos = steps
          .filter((x) => (x.step_type === "capture_documento" || x.step_type === "finalizar_cadastro") && x.is_active)
          .map((x) => x.position)
          .sort((a, b) => a - b)[0];
        const isBetween =
          captureContaPos != null &&
          captureDocOrFinalPos != null &&
          s.position > captureContaPos &&
          s.position < captureDocOrFinalPos;
        if (isBetween) {
          const btns = getButtons(s);
          if (btns.length === 0) {
            warnings.push({
              id: `${s.id}:conversion_step_no_cta`,
              stepId: s.id,
              level: "warn",
              kind: "conversion_step_no_cta",
              message:
                "Passo de simulação/conversão sem botão CTA. Adicione 'Quero finalizar' ou 'Tenho dúvidas' para guiar o cliente — sem isso, o lead pode parar aqui e não avançar para o cadastro.",
            });
          }
        }
      }
    }

    // Passo com fallback "goto" sem timeout que É uma pergunta (tem botões
    // ou o tipo é de captura, ou o texto termina em "?") → aviso de que vai
    // avançar sem esperar o cliente.
    for (const s of steps) {
      if (!s.is_active) continue;
      const fb = (s as any).fallback as { mode?: string; timeout_sec?: number | null } | null;
      if (!fb || fb.mode !== "goto") continue;
      if (fb.timeout_sec && fb.timeout_sec > 0) continue;
      // É uma pergunta? (botões, tipo captura, ou texto com ?)
      const hasButtons = getButtons(s).length > 0;
      const isCapture = (s.step_type ?? "").startsWith("capture_") || s.step_type === "confirm_phone";
      const endsWithQuestion = /\?\s*$/.test(s.message_text ?? "");
      if (hasButtons || isCapture || endsWithQuestion) {
        warnings.push({
          id: `${s.id}:goto_no_wait`,
          stepId: s.id,
          level: "warn",
          kind: "goto_no_wait",
          message:
            "Este passo faz uma pergunta, mas está configurado para avançar sem esperar a resposta do cliente. Abra o passo, vá em Regras e troque para \"Esperar e repetir a mensagem\".",
        });
      }
    }

    // Variável usada ANTES de ser capturada (ex.: passo de simulação usa
    // {{valor_conta}} mas vem antes do passo que pergunta o valor). Resultado:
    // a mensagem sai com o campo vazio ("Na sua conta de , você economiza ...").
    // Mapa: qual variável cada tipo de passo PRODUZ.
    // economia_* são DERIVADAS do valor da conta (render-vars.ts: billNum * 0.20).
    // Por isso o passo capture_conta as "produz" junto com valor_conta — usá-las
    // antes da captura sai em branco, igual a economia_range.
    const VAR_PRODUCERS: Record<string, string[]> = {
      capture_conta: ["valor_conta", "economia_range", "economia_mensal", "economia_anual", "economia_faixa"],
      capture_documento: ["nome", "cpf"],
      capture_email: ["email"],
      confirm_phone: ["telefone"],
    };
    // Variáveis RASTREÁVEIS na checagem de ordem: as canônicas (KNOWN_VARS) +
    // tudo que algum passo PRODUZ (VAR_PRODUCERS). Assim economia_mensal/anual/
    // faixa entram sem precisar virar canônicas — e sinônimos não-produzidos
    // (ex.: {{valor}}, {{conta}}) continuam de fora, evitando falso positivo.
    const TRACKABLE_VARS = new Set<string>([
      ...KNOWN_VARS,
      ...Object.values(VAR_PRODUCERS).flat(),
    ]);
    const orderedForVars = [...steps].filter((s) => s.is_active).sort((a, b) => a.position - b.position);
    const producedSoFar = new Set<string>();
    for (const s of orderedForVars) {
      // 1) Checa o texto do passo: usa variável ainda não produzida?
      const usedVars = (s.message_text?.match(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g) ?? [])
        .map((m) => m.replace(/[{}\s]/g, "").toLowerCase())
        .filter((v) => TRACKABLE_VARS.has(v));
      for (const v of usedVars) {
        // 'nome' costuma vir do WhatsApp; não alarmamos por ele.
        if (v === "nome" || v === "representante") continue;
        if (!producedSoFar.has(v)) {
          warnings.push({
            id: `${s.id}:var_before_capture:${v}`,
            stepId: s.id,
            level: "warn",
            kind: "var_before_capture",
            message:
              `Este passo usa a informação "${labelVar(v)}", mas ela ainda não foi pedida ao cliente até aqui. A mensagem pode sair com um espaço em branco. Mova este passo para depois de pedir essa informação.`,
          });
        }
      }
      // 2) Marca o que ESTE passo produz.
      for (const v of (VAR_PRODUCERS[s.step_type ?? ""] ?? [])) producedSoFar.add(v);
    }

    // Fluxo sem fim: nenhum passo leva a "finalizar cadastro" nem a "humano".
    // O cliente conversa mas nunca fecha nem é transferido.
    if (steps.filter((s) => s.is_active).length >= 2) {
      const hasEnding = steps.some(
        (s) =>
          s.is_active &&
          (s.step_type === "finalizar_cadastro" ||
            s.transitions.some((t) => t.goto_special === "humano")),
      );
      if (!hasEnding) {
        // aponta no primeiro passo (início) para o aviso ter um lar.
        const first = orderedForVars[0];
        if (first) {
          warnings.push({
            id: `${first.id}:flow_no_ending`,
            stepId: first.id,
            level: "warn",
            kind: "flow_no_ending",
            message:
              "Este fluxo não tem um final claro: nenhum passo finaliza o cadastro nem transfere para um atendente. O cliente pode ficar preso na conversa. Adicione um passo \"Finalizar cadastro\" ou uma saída para \"falar com humano\".",
          });
        }
      }
    }

    // Botões demais: mais de 3 opções. No WhatsApp via Evolution vira lista
    // numerada; acima de ~5 fica confuso e o cliente erra o número.
    for (const s of steps) {
      if (!s.is_active) continue;
      const btns = getButtons(s);
      if (btns.length > 5) {
        warnings.push({
          id: `${s.id}:too_many_buttons`,
          stepId: s.id,
          level: "warn",
          kind: "too_many_buttons",
          message:
            `Este passo tem ${btns.length} opções. Muitas opções confundem o cliente (e no WhatsApp viram uma lista numerada longa). Tente reduzir para até 3 ou 4 opções principais.`,
        });
      }
    }

    // Mídia faltando: passo que tem um slot de mídia configurado, mas sem
    // arquivo de fato (contadores vindos do FluxoBuilder). Só roda quando os
    // contadores são fornecidos.
    if (mediaCounts) {
      for (const s of steps) {
        if (!s.is_active || !s.slot_key) continue;
        const c = mediaCounts[s.slot_key];
        const total = c ? (c.audio + c.image + c.video) : 0;
        // Heurística: o passo "espera" mídia se a mensagem referencia áudio/
        // vídeo OU o slot_key sugere mídia. Sem arquivo => aviso.
        const expectsMedia = /áudio|audio|vídeo|video|🎥|🔊/i.test(
          `${s.title ?? ""} ${s.message_text ?? ""}`,
        ) || /audio|video|explica|como_funciona/i.test(s.slot_key);
        if (expectsMedia && total === 0) {
          warnings.push({
            id: `${s.id}:media_missing`,
            stepId: s.id,
            level: "warn",
            kind: "media_missing",
            message:
              "Este passo parece enviar um áudio ou vídeo, mas nenhum arquivo foi anexado. O cliente não vai receber a mídia. Abra o passo, vá em Mídias e adicione o arquivo.",
          });
        }
      }
    }


    const byStep: Record<string, FlowWarning[]> = {};
    for (const w of warnings) {
      (byStep[w.stepId] ||= []).push(w);
    }

    // Consolida autofixes por step (último ganha — UI deve chamar 1x por step)
    const byStepFix: Record<string, Partial<Step>> = {};
    for (const w of warnings) {
      if (!w.autoFix) continue;
      const patch = w.autoFix();
      if (!patch) continue;
      byStepFix[w.stepId] = { ...(byStepFix[w.stepId] || {}), ...patch };
    }
    const autoFixablePatches = Object.entries(byStepFix).map(([stepId, patch]) => ({ stepId, patch }));

    return {
      warnings,
      byStep,
      total: warnings.length,
      errors: warnings.filter((w) => w.level === "error").length,
      autoFixablePatches,
    };
  }, [steps, mediaCounts]);
}
