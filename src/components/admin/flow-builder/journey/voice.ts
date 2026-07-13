// voice.ts — "personalidade" do Consultor de Fluxo (Iris).
//
// Centraliza TODAS as frases em pt-BR que o painel/tour/dialogs exibem.
// Funções puras, determinísticas (entrada Step/FlowWarning → string),
// sem IA, sem efeito colateral. Mantém o tom consistente em todas as
// superfícies (StepCoachPanel, JourneyStepper, FlowTourOverlay, e
// futuramente FlowHealthDialog/StepInspector).
//
// Regra de ouro: **sem jargão técnico bruto**. Nunca aparecer
// "goto_special", "slot_key", "trigger_intent", "transition" cru
// para o consultor. Se for jargão, traduzimos.

import type { Step } from "../flowTypes";
import type { StepExit, ExitDestKind } from "../flowExits";
import type { FlowWarning } from "../useFlowValidation";

/** Frase que descreve UMA saída do passo, em linguagem natural. */
export function falarRegra(exit: StepExit): string {
  const destino = exit.destLabel.replace(/^[⚠📝🔁🤖👤🏁#]\s?/u, "").trim() || exit.destLabel;

  if (exit.kind === "button") {
    if (exit.missing) {
      return `Se o lead tocar em "${exit.label}", o fluxo trava — esse botão ainda não tem destino.`;
    }
    return `Se o lead tocar em "${exit.label}", ele vai para ${destino}.`;
  }
  if (exit.kind === "keyword") {
    if (exit.missing) {
      return `Se o lead escrever "${exit.label}", trava — essa regra está sem destino.`;
    }
    return `Se o lead escrever "${exit.label}", ele vai para ${destino}.`;
  }
  // default
  if (exit.destKind === "repeat") return "Se nada casar, eu repito a pergunta — protege contra silêncio.";
  if (exit.destKind === "ai") return "Se nada casar, a IA responde livre — útil para perguntas abertas.";
  if (exit.destKind === "end") return "Se nada casar, este é o fim do fluxo.";
  if (exit.destKind === "humano") return "Se nada casar, transfiro para um humano.";
  if (exit.destKind === "cadastro") return "Se nada casar, pulo direto pro cadastro.";
  if (exit.missing) return "Se nada casar, o fluxo trava — falta definir o caminho padrão.";
  return `Se nada casar, sigo para ${destino}.`;
}

/** Tradução humana de um aviso/erro. Inclui CTA quando faz sentido. */
const WARN_VOZ: Record<FlowWarning["kind"], { titulo: string; cta?: string }> = {
  empty_message: { titulo: "Esse passo ainda não tem mensagem para enviar.", cta: "Escrever a mensagem" },
  unresolved_var: { titulo: "Você está usando uma variável que eu não conheço.", cta: "Conferir o texto" },
  var_before_capture: { titulo: "Você usa uma informação antes de pedi-la — vai sair em branco.", cta: "Reordenar os passos" },
  goto_no_wait: { titulo: "Esse passo pergunta, mas não espera a resposta. Eu trocaria para 'esperar e repetir'.", cta: "Ajustar a regra" },
  media_missing: { titulo: "Parece que esse passo manda áudio/vídeo, mas nenhum arquivo foi anexado.", cta: "Anexar a mídia" },
  flow_no_ending: { titulo: "O fluxo não tem fim claro — nem finaliza cadastro nem transfere pra humano.", cta: "Adicionar finalização" },
  too_many_buttons: { titulo: "Muitos botões aqui. Acima de 5 o cliente se perde.", cta: "Reduzir as opções" },
  button_no_rule: { titulo: "Tem botão sem destino. O cliente toca e não acontece nada.", cta: "Ligar o botão a um passo" },
  transition_no_dest: { titulo: "Tem uma regra sem destino configurado.", cta: "Apagar ou apontar a regra" },
  transition_dest_missing: { titulo: "Uma regra aponta para um passo que foi removido.", cta: "Corrigir o destino" },
  transition_dest_inactive: { titulo: "Uma regra aponta para um passo desligado.", cta: "Reativar ou trocar" },
  orphan_step: { titulo: "Nenhum passo leva até aqui — esse passo está solto.", cta: "Ligar a partir de algum lugar" },
  loop_detected: { titulo: "Detectei um loop. O cliente pode ficar dando voltas sem sair.", cta: "Quebrar o ciclo" },
  ocr_without_confirm: { titulo: "Depois do OCR falta um passo de confirmação dos dados lidos.", cta: "Aplicar template de confirmação" },
  ai_no_buttons: { titulo: "IA livre sem botões: o cliente fica em loop. Coloque 'Simular' e 'Falar com humano'.", cta: "Adicionar botões de saída" },
  ai_no_humano_exit: { titulo: "Falta uma saída de emergência 'Falar com humano' nessa IA.", cta: "Adicionar saída humano" },
  conversion_step_no_cta: { titulo: "Esse passo de conversão não tem CTA. O lead recebe e não sabe o que fazer.", cta: "Adicionar 'Quero finalizar'" },
  activate_to_sim_path: { titulo: "Ativar/cadastrar está indo para simulação. Tem que ir para documento ou conta de cadastro.", cta: "Corrigir destino" },
  activate_skips_conta: { titulo: "Ativar/cadastrar está pulando a conta de luz. Aponte para a conta de cadastro — o robô pula sozinho se o cliente já tiver conta.", cta: "Apontar para a conta de cadastro" },
};

export function falarDiagnostico(w: FlowWarning): { titulo: string; detalhe: string; cta?: string } {
  const voz = WARN_VOZ[w.kind];
  return { titulo: voz?.titulo ?? "Algo merece atenção aqui.", detalhe: w.message, cta: voz?.cta };
}

/** Saudação curta quando o consultor abre/troca de passo. */
export function falarEtapa(step: Step, anterior: Step | null): string {
  if (!anterior) return `Você está no passo #${step.position} — "${step.title}". Vamos por aqui.`;
  if (anterior.id === step.id) return `Ainda no #${step.position} — "${step.title}".`;
  if (step.position > anterior.position) {
    return `Boa, agora vamos pro #${step.position} — "${step.title}". Aqui é onde a conversa segue.`;
  }
  return `Voltamos pro #${step.position} — "${step.title}". Vamos revisar.`;
}

/** Tradução curta de um destino "abstrato" (sem passo) — para legenda. */
export function falarDestinoAbstrato(kind: ExitDestKind): string {
  switch (kind) {
    case "humano": return "atendente humano";
    case "cadastro": return "tela de cadastro";
    case "repeat": return "repetir esse passo";
    case "ai": return "resposta da IA";
    case "end": return "fim do fluxo";
    case "missing": return "passo removido";
    case "none": return "nenhum destino";
    case "inactive": return "passo desligado";
    default: return "próximo passo";
  }
}
