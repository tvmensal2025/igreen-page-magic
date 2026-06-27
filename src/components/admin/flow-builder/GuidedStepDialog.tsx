// GuidedStepDialog — "Estúdio da Iris" (3 colunas, inspirado no modal de anúncio).
//
// VISÃO
// -----
// Um estúdio único que fica aberto enquanto o consultor MONTA A CONVERSA:
//   • COLUNA 1 (esquerda): a trilha de passos já criados + o rascunho atual.
//   • COLUNA 2 (meio): a Iris, onde se edita UM passo por vez (falar | pedir).
//   • COLUNA 3 (direita): um celular que SIMULA a conversa inteira com um
//     cliente fictício (João Silva) respondendo dados coerentes a cada passo.
//
// Cada passo é PERSISTIDO assim que adicionado (via `onCreate`, que usa o
// useFlowStepsCrud otimista + revert) — sem big-bang de salvar-tudo-no-fim,
// então nunca fica fluxo pela metade. O modal continua aberto e o rascunho
// se reinicia para o próximo passo. O celular reflete `steps` (já salvos) +
// o rascunho ao vivo.
//
// DETERMINÍSTICO: a intenção (falar/pedir) mapeia direto para o step_type
// correto (GUIDED_CAPTURE_OPTIONS, validado contra o runtime). Todo botão
// nasce com destino EXPLÍCITO (paridade com StepInspector.setButtonGoto), então
// nada cai no fallback `repeat`.

import { useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  ArrowRight,
  Check,
  GraduationCap,
  Image as ImageIcon,
  Loader2,
  MessageCircle,
  Mic,
  Inbox,
  Plus,
  Rocket,
  ScanLine,
  Video,
  ArrowLeft,
} from "lucide-react";
import {
  BUTTON_PRESETS,
  GUIDED_CAPTURE_OPTIONS,
  STEP_TYPE_OPTIONS,
  computeFlowCoverage,
  defaultPromptForType,
  type GuidedCaptureOption,
  type GuidedIntent,
  type Step,
  type Transition,
  type Capture,
  type IconKey,
} from "./flowTypes";
import ConversationPreview from "./ConversationPreview";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Cria o passo (geralmente o `addStep` do useFlowStepsCrud). */
  onCreate: (seed: Partial<Step>) => Promise<Step | null>;
  /** Passos já existentes no fluxo — viram destinos possíveis dos botões. */
  steps: Step[];
  /** Nome do consultor, para a Iris personalizar a saudação. */
  consultantName?: string;
  /**
   * Caminho A: chamado APÓS criar um passo que pediu mídia, com o passo criado.
   * O FluxoBuilder usa isso para abrir o painel de mídia no passo recém-criado.
   */
  onRequestMedia?: (created: Step) => void;
  /** Remove um passo (para o botão "voltar/desfazer último passo"). */
  onDeleteStep?: (id: string) => Promise<void> | void;
}

/** Variáveis que o consultor pode inserir com 1 clique no texto. */
const VARIAVEIS: { token: string; label: string }[] = [
  { token: "{{nome}}", label: "nome" },
  { token: "{{valor_conta}}", label: "valor da conta" },
  { token: "{{economia_mensal}}", label: "economia/mês" },
  { token: "{{representante}}", label: "nome do consultor" },
];

/** Ícone padrão por tipo de passo (espelha o uso no resto do construtor). */
function iconForType(stepType: string): IconKey {
  switch (stepType) {
    case "capture_conta":
    case "capture_documento":
      return "file";
    case "capture_name":
    case "capture_email":
    case "confirm_phone":
      return "user";
    case "finalizar_cadastro":
      return "sparkle";
    default:
      return "msg";
  }
}

interface DraftButton {
  id: string;
  title: string;
  dest: string;
}

const DEST_HUMANO = "special:humano";
const DEST_CADASTRO = "special:cadastro";

/** Entrada pura para montar o seed do passo — espelha o estado do diálogo. */
export interface GuidedStepInput {
  stepType: string;
  titulo: string;
  mensagem: string;
  botoes: DraftButton[];
}

function destToGoto(dest: string): Pick<Transition, "goto_step_id" | "goto_special"> {
  return {
    goto_step_id: dest.startsWith("step:") ? dest.slice(5) : null,
    goto_special: dest.startsWith("special:")
      ? (dest.slice(8) as Transition["goto_special"])
      : null,
  };
}

/** Mesma regra de "aceita botões" usada na UI (extraída p/ teste). */
export function aceitaBotoesPara(stepType: string): boolean {
  return (
    stepType === "message" ||
    stepType === "confirm_phone" ||
    stepType === "finalizar_cadastro"
  );
}

/**
 * Função PURA que monta o `Partial<Step>` final a partir do estado do diálogo.
 * Garantia central (Opção A): cada botão vira UMA transition com destino
 * explícito, no mesmo formato do `StepInspector.setButtonGoto`.
 */
export function buildGuidedStepSeed(input: GuidedStepInput): Partial<Step> {
  const { stepType, titulo, mensagem, botoes } = input;
  const transitions: Transition[] = [];
  const captures: Capture[] = [];

  if (aceitaBotoesPara(stepType) && botoes.length > 0) {
    captures.push({
      field: "_buttons",
      enabled: true,
      value: botoes.map((b) => ({ id: b.id, title: b.title })),
    });
    for (const b of botoes) {
      const tituloSemEmoji = b.title.replace(/^\S+\s/, "").trim();
      transitions.push({
        trigger_intent: "palavra_chave",
        trigger_phrases: [b.title, tituloSemEmoji, b.id],
        ...destToGoto(b.dest),
      });
    }
  }

  return {
    step_type: stepType,
    title: titulo.trim() || defaultTitleForType(stepType),
    message_text: mensagem.trim(),
    icon: iconForType(stepType),
    transitions,
    captures,
    fallback: { mode: "repeat" },
  };
}

/** Título padrão legível por tipo (usado quando o consultor não nomeia). */
function defaultTitleForType(stepType: string): string {
  const opt = STEP_TYPE_OPTIONS.find((o) => o.value === stepType);
  return opt ? opt.label : "Passo";
}

export default function GuidedStepDialog({
  open,
  onOpenChange,
  onCreate,
  steps,
  consultantName,
  onRequestMedia,
  onDeleteStep,
}: Props) {
  // Rascunho do passo em edição (coluna do meio).
  const [intent, setIntent] = useState<GuidedIntent | null>(null);
  const [captureKey, setCaptureKey] = useState<string | null>(null);
  const [titulo, setTitulo] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [botoes, setBotoes] = useState<DraftButton[]>([]);
  // Tipos de mídia selecionados, NA ORDEM de clique (vira media_order).
  // "text" = a mensagem digitada; "audio"/"image"/"video" exigem upload depois.
  const [tiposMidia, setTiposMidia] = useState<string[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [revisando, setRevisando] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const primeiroNome =
    (consultantName && consultantName.trim().split(/\s+/)[0]) || null;

  const captureOpt: GuidedCaptureOption | null = useMemo(
    () => GUIDED_CAPTURE_OPTIONS.find((o) => o.key === captureKey) ?? null,
    [captureKey],
  );

  const stepType = intent === "pedir" ? captureOpt?.stepType ?? "" : intent === "falar" ? "message" : "";
  const aceitaBotoes = aceitaBotoesPara(stepType);

  const destOptions = useMemo(() => {
    const base = [
      { value: DEST_CADASTRO, label: "Ir para o cadastro", emoji: "📝" },
      { value: DEST_HUMANO, label: "Falar com um atendente", emoji: "👤" },
    ];
    const stepOpts = [...steps]
      .filter((s) => s.is_active)
      .sort((a, b) => a.position - b.position)
      .map((s) => ({ value: `step:${s.id}`, label: `#${s.position} ${s.title}`, emoji: "➡️" }));
    return [...base, ...stepOpts];
  }, [steps]);

  function resetDraft() {
    setIntent(null);
    setCaptureKey(null);
    setTitulo("");
    setMensagem("");
    setBotoes([]);
    setTiposMidia([]);
  }

  function fechar() {
    resetDraft();
    setSalvando(false);
    setRevisando(false);
    onOpenChange(false);
  }

  function escolherIntent(v: GuidedIntent) {
    setIntent(v);
    if (v === "falar") setCaptureKey(null);
    setBotoes([]);
  }

  function inserirVariavel(token: string) {
    const el = textareaRef.current;
    if (!el) {
      setMensagem((m) => m + token);
      return;
    }
    const start = el.selectionStart ?? mensagem.length;
    const end = el.selectionEnd ?? mensagem.length;
    const novo = mensagem.slice(0, start) + token + mensagem.slice(end);
    setMensagem(novo);
    // Recoloca o cursor após o token inserido.
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + token.length;
      el.setSelectionRange(pos, pos);
    });
  }

  function addBotaoPreset(preset: (typeof BUTTON_PRESETS)[number]) {
    if (botoes.some((b) => b.id === preset.id)) return;
    setBotoes((cur) => [
      ...cur,
      {
        id: preset.id,
        title: `${preset.emoji} ${preset.title}`,
        dest: preset.id === "humano" ? DEST_HUMANO : DEST_CADASTRO,
      },
    ]);
  }

  function removeBotao(id: string) {
    setBotoes((cur) => cur.filter((b) => b.id !== id));
  }

  function setBotaoDest(id: string, dest: string) {
    setBotoes((cur) => cur.map((b) => (b.id === id ? { ...b, dest } : b)));
  }

  // Mídia que exige UPLOAD (áudio/imagem/vídeo). "text" é a própria mensagem.
  const tiposUpload = useMemo(
    () => tiposMidia.filter((t) => t !== "text"),
    [tiposMidia],
  );

  function montarSeed(): Partial<Step> {
    const seed = buildGuidedStepSeed({ stepType, titulo, mensagem, botoes });
    if (tiposMidia.length > 0) {
      seed.media_order = tiposMidia;
      // slot_key só é necessário quando há mídia de UPLOAD (não só texto).
      if (tiposUpload.length > 0) seed.slot_key = `passo_${Date.now().toString(36)}`;
    }
    return seed;
  }

  // Rascunho válido para adicionar? Falar exige mensagem; pedir exige escolha.
  const rascunhoValido =
    intent === "falar"
      ? mensagem.trim().length > 0
      : intent === "pedir"
        ? !!captureOpt
        : false;

  // Motivo de o botão estar travado (transparência — pediu explicação).
  const motivoTravado = (() => {
    if (!intent) return "Escolha se quer falar com o cliente ou pedir uma informação.";
    if (intent === "falar" && mensagem.trim().length === 0) return "Escreva a mensagem que o bot vai enviar.";
    if (intent === "pedir" && !captureOpt) return "Escolha qual informação você quer pedir.";
    return null;
  })();

  async function adicionarPasso() {
    if (!rascunhoValido) return;
    setSalvando(true);
    const created = await onCreate(montarSeed());
    setSalvando(false);
    if (created) {
      if (tiposUpload.length > 0 && onRequestMedia) onRequestMedia(created);
      resetDraft(); // pronto para o próximo passo; modal continua aberto
    }
  }

  // Passo "fantasma" do rascunho atual, para aparecer no celular ao vivo.
  const draftStep: Step | null = useMemo(() => {
    if (!intent || !stepType) return null;
    const seed = buildGuidedStepSeed({ stepType, titulo, mensagem, botoes });
    // No preview, se a mensagem está vazia numa captura, mostra o texto PADRÃO
    // que o bot enviaria (por tipo) — assim "nome" mostra "Qual seu nome?" e
    // não fica vazio nem com texto de outro passo.
    if (!seed.message_text) {
      seed.message_text = defaultPromptForType(stepType);
    }
    return {
      id: "__draft__",
      flow_id: "draft",
      position: steps.length + 1,
      step_key: null,
      summary: null,
      text_delay_ms: null,
      slot_key: tiposUpload.length > 0 ? "draft_slot" : null,
      is_active: true,
      layout: null,
      ...seed,
      media_order: tiposMidia.length > 0 ? tiposMidia : null,
    } as Step;
  }, [intent, stepType, titulo, mensagem, botoes, tiposMidia, tiposUpload.length, steps.length]);

  const previewSteps = useMemo(
    () => (draftStep ? [...steps, draftStep] : steps),
    [steps, draftStep],
  );

  const ordenados = useMemo(
    () => [...steps].sort((a, b) => a.position - b.position),
    [steps],
  );

  // Cobertura do cadastro (até fechar 100% no portal). Guia o consultor.
  const coverage = useMemo(() => computeFlowCoverage(steps), [steps]);

  /** Mapa marco → captura do catálogo, para o atalho "adicionar o que falta". */
  function selecionarMarco(milestoneKey: string) {
    if (milestoneKey === "finalizar") {
      void onCreate({
        step_type: "finalizar_cadastro",
        title: "Finalizar cadastro",
        message_text: "",
        icon: "sparkle",
        transitions: [],
        captures: [],
        fallback: { mode: "repeat" },
      });
      return;
    }
    const MARCO_PARA_TIPO: Record<string, string> = {
      conta: "capture_conta",
      documento: "capture_documento",
      email: "capture_email",
      telefone: "confirm_phone",
    };
    const tipo = MARCO_PARA_TIPO[milestoneKey];
    const opt = GUIDED_CAPTURE_OPTIONS.find((o) => o.stepType === tipo);
    if (opt) {
      setIntent("pedir");
      setCaptureKey(opt.key);
    }
  }

  const irisFala = (() => {
    if (!intent) {
      return primeiroNome
        ? `Oi ${primeiroNome}! Vamos montar a conversa. O que esse passo faz?`
        : "Vamos montar a conversa. O que esse passo faz?";
    }
    if (intent === "falar") return "Beleza! Escreve o que eu devo dizer. Dá pra usar os botões de variável e anexar mídia.";
    if (!captureOpt) return "E qual informação você quer que eu peça pro cliente?";
    return `Combinado: vou pedir ${captureOpt.label.toLowerCase()}. Você ajusta como eu peço aqui embaixo.`;
  })();

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) fechar(); }}>
      <DialogContent className="max-h-[92vh] gap-0 overflow-hidden border-white/20 bg-background/80 p-0 shadow-2xl backdrop-blur-2xl supports-[backdrop-filter]:bg-background/70 sm:max-w-5xl dark:border-white/10 dark:bg-zinc-900/70">
        <DialogHeader className="space-y-0 border-b border-white/20 bg-gradient-to-r from-primary/15 via-primary/5 to-transparent px-6 py-4 dark:border-white/10">
          <DialogTitle className="flex items-center gap-3 text-base">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/15 text-primary ring-1 ring-primary/20 backdrop-blur">
              <GraduationCap className="h-5 w-5" />
            </span>
            Montar conversa com a Iris
          </DialogTitle>
          <DialogDescription className="sr-only">
            Estúdio para montar a conversa do bot, passo a passo, com preview ao vivo.
          </DialogDescription>
        </DialogHeader>

        {/* TELA DE ACOMPANHAMENTO / FINALIZAÇÃO (ao clicar Concluir) */}
        {revisando && (
          <div className="max-h-[78vh] space-y-4 overflow-y-auto p-6">
            <div className="flex items-start gap-2.5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                <GraduationCap className="h-4 w-4" />
              </span>
              <p className="rounded-2xl rounded-tl-sm bg-muted px-3.5 py-2 text-sm">
                {coverage.complete
                  ? "Tudo pronto! Seu fluxo leva o cliente do início até o cadastro no portal. 🎉"
                  : "Vamos conferir se não falta nada pro cadastro fechar 100%. Te mostro o que ainda falta:"}
              </p>
            </div>

            {/* Progresso */}
            <div className="rounded-xl border bg-card p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-semibold">Cadastro completo</span>
                <span className={cn("text-sm font-bold", coverage.complete ? "text-primary" : "text-muted-foreground")}>
                  {coverage.percent}%
                </span>
              </div>
              <div className="mb-3 h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${coverage.percent}%` }} />
              </div>

              <ul className="space-y-2">
                {coverage.milestones.map(({ milestone, done }) => (
                  <li key={milestone.key} className="flex items-start gap-2.5">
                    <span
                      className={cn(
                        "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px]",
                        done ? "bg-primary text-primary-foreground" : "border border-dashed border-muted-foreground/40 text-muted-foreground",
                      )}
                    >
                      {done ? <Check className="h-3 w-3" /> : "!"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 text-sm font-medium">
                        {milestone.label}
                        {done ? (
                          <Badge variant="secondary" className="text-[10px]">já tem</Badge>
                        ) : (
                          <Badge variant="outline" className="border-warning/50 text-[10px] text-warning">falta</Badge>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">{milestone.hint}</p>
                    </div>
                    {!done && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="shrink-0"
                        disabled={salvando}
                        onClick={() => { selecionarMarco(milestone.key); setRevisando(false); }}
                      >
                        <Plus className="mr-1 h-3 w-3" /> Adicionar
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </div>

            {/* Aviso / ação final */}
            {coverage.complete ? (
              <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
                <Rocket className="h-4 w-4 shrink-0 text-primary" />
                <span>Fluxo completo: o último passo <strong>envia o cadastro ao portal iGreen</strong> automaticamente.</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm">
                <span className="text-base">⚠️</span>
                <span>
                  Ainda falta <strong>{coverage.requiredCount - coverage.doneCount}</strong>{" "}
                  {coverage.requiredCount - coverage.doneCount === 1 ? "passo" : "passos"} pro cadastro fechar no portal.
                  Você pode concluir mesmo assim, mas o cliente não vai chegar até o fim.
                </span>
              </div>
            )}

            <div className="flex items-center justify-between gap-2 border-t pt-3">
              <Button variant="ghost" size="sm" onClick={() => setRevisando(false)}>
                <ArrowLeft className="mr-1 h-3 w-3" /> Voltar a montar
              </Button>
              <Button size="sm" onClick={() => { setRevisando(false); fechar(); }}>
                {coverage.complete ? "Concluir fluxo" : "Concluir mesmo assim"}
              </Button>
            </div>
          </div>
        )}

        {!revisando && (
        <>

        {/* 3 colunas */}
        <div className="grid grid-cols-1 md:grid-cols-[220px_1fr_320px]">
          {/* COLUNA 1 — trilha de passos */}
          <aside className="hidden max-h-[70vh] overflow-y-auto border-r border-white/15 bg-white/5 p-3 backdrop-blur-sm md:block dark:border-white/5 dark:bg-white/[0.02]">
            <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Passos da conversa
            </p>
            <ol className="space-y-1.5">
              {ordenados.map((s, i) => (
                <li
                  key={s.id}
                  className="flex items-start gap-2 rounded-lg border border-white/20 bg-white/40 p-2 text-left backdrop-blur-sm dark:bg-white/5"
                >
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary">
                    {i + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium">{s.title}</span>
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {STEP_TYPE_OPTIONS.find((o) => o.value === s.step_type)?.label ?? s.step_type}
                    </span>
                  </span>
                </li>
              ))}

              {/* Rascunho em edição */}
              {draftStep && (
                <li className="flex items-start gap-2 rounded-lg border-2 border-dashed border-primary/40 bg-primary/5 p-2">
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
                    {ordenados.length + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium">{draftStep.title}</span>
                    <span className="block text-[10px] text-primary">editando…</span>
                  </span>
                </li>
              )}

              {ordenados.length === 0 && !draftStep && (
                <li className="rounded-lg border border-dashed p-3 text-center text-[11px] text-muted-foreground">
                  Nenhum passo ainda. Comece pela coluna do meio.
                </li>
              )}
            </ol>

            {/* Painel "Cadastro 100%" — guia o consultor até fechar no portal */}
            <div className="mt-4 rounded-xl border border-white/20 bg-white/40 p-3 backdrop-blur-sm dark:bg-white/5">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Cadastro completo
                </span>
                <span className={cn("text-xs font-bold", coverage.complete ? "text-primary" : "text-muted-foreground")}>
                  {coverage.percent}%
                </span>
              </div>
              {/* Barra de progresso */}
              <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${coverage.percent}%` }}
                />
              </div>
              <ul className="space-y-1">
                {coverage.milestones.map(({ milestone, done }) => (
                  <li key={milestone.key} className="flex items-center gap-1.5 text-[11px]">
                    <span
                      className={cn(
                        "grid h-4 w-4 shrink-0 place-items-center rounded-full text-[9px]",
                        done ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                      )}
                    >
                      {done ? <Check className="h-2.5 w-2.5" /> : ""}
                    </span>
                    <span className={done ? "text-foreground" : "text-muted-foreground"}>
                      {milestone.label}
                    </span>
                  </li>
                ))}
              </ul>
              {!coverage.complete && coverage.next && (
                <button
                  type="button"
                  onClick={() => selecionarMarco(coverage.next!.key)}
                  className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg bg-primary/10 px-2 py-1.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/20"
                >
                  <Plus className="h-3 w-3" /> Adicionar: {coverage.next.label}
                </button>
              )}
              {coverage.complete && (
                <p className="mt-2 flex items-center gap-1 text-[11px] font-medium text-primary">
                  <Check className="h-3 w-3" /> Fluxo pronto pra fechar no portal!
                </p>
              )}
            </div>
          </aside>

          {/* COLUNA 2 — Iris (edição) */}
          <section className="max-h-[70vh] space-y-4 overflow-y-auto p-5">
            {/* Balão da Iris */}
            <div className="flex items-start gap-2.5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                <GraduationCap className="h-4 w-4" />
              </span>
              <p className="rounded-2xl rounded-tl-sm bg-muted px-3.5 py-2 text-sm">{irisFala}</p>
            </div>

            {/* Intenção — ao escolher uma, a outra RECOLHE (vira resumo compacto) */}
            {!intent ? (
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => escolherIntent("falar")}
                  className="flex flex-col items-start gap-1.5 rounded-xl border border-white/20 bg-white/30 p-3 text-left backdrop-blur-sm transition-all hover:border-primary/50 hover:bg-primary/5 dark:bg-white/5"
                >
                  <span className="grid h-8 w-8 place-items-center rounded-full bg-primary/10 text-primary">
                    <MessageCircle className="h-4 w-4" />
                  </span>
                  <span className="text-sm font-semibold">Falar com o cliente</span>
                  <span className="text-[11px] text-muted-foreground">Mensagem, áudio/vídeo, botões.</span>
                </button>
                <button
                  type="button"
                  onClick={() => escolherIntent("pedir")}
                  className="flex flex-col items-start gap-1.5 rounded-xl border border-white/20 bg-white/30 p-3 text-left backdrop-blur-sm transition-all hover:border-primary/50 hover:bg-primary/5 dark:bg-white/5"
                >
                  <span className="grid h-8 w-8 place-items-center rounded-full bg-primary/10 text-primary">
                    <Inbox className="h-4 w-4" />
                  </span>
                  <span className="text-sm font-semibold">Pedir uma informação</span>
                  <span className="text-[11px] text-muted-foreground">Nome, conta, documento, e-mail, telefone.</span>
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => { setIntent(null); setCaptureKey(null); setBotoes([]); }}
                className="flex w-full items-center gap-2.5 rounded-xl border border-primary/40 bg-primary/10 p-2.5 text-left transition-all hover:bg-primary/15"
              >
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
                  {intent === "falar" ? <MessageCircle className="h-4 w-4" /> : <Inbox className="h-4 w-4" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">
                    {intent === "falar" ? "Falar com o cliente" : "Pedir uma informação"}
                  </span>
                  <span className="block text-[11px] text-muted-foreground">Toque para trocar</span>
                </span>
                <span className="text-[11px] font-medium text-primary">trocar</span>
              </button>
            )}

            {/* Pedir: escolher o quê — ao selecionar uma, as outras RECOLHEM */}
            {intent === "pedir" && !captureOpt && (
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">O que você quer pedir?</Label>
                <div className="grid grid-cols-1 gap-1.5">
                  {GUIDED_CAPTURE_OPTIONS.map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setCaptureKey(opt.key)}
                      className="flex items-start gap-2 rounded-lg border border-white/20 bg-white/30 p-2.5 text-left backdrop-blur-sm transition-all hover:border-primary/50 hover:bg-primary/5 dark:bg-white/5"
                    >
                      <span className="text-lg">{opt.emoji}</span>
                      <div className="min-w-0">
                        <span className="flex items-center gap-1.5 text-sm font-medium">
                          {opt.label}
                          {opt.optional && <Badge variant="outline" className="text-[10px]">opcional</Badge>}
                          {(opt.stepType === "capture_conta" || opt.stepType === "capture_documento") && (
                            <Badge variant="secondary" className="gap-1 text-[10px]">
                              <ScanLine className="h-3 w-3" /> lê sozinho
                            </Badge>
                          )}
                        </span>
                        <p className="text-xs text-muted-foreground">{opt.hint}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Captura escolhida — resumo compacto + voltar pra trocar */}
            {intent === "pedir" && captureOpt && (
              <button
                type="button"
                onClick={() => setCaptureKey(null)}
                className="flex w-full items-center gap-2.5 rounded-xl border border-primary/40 bg-primary/10 p-2.5 text-left transition-all hover:bg-primary/15"
              >
                <span className="text-lg">{captureOpt.emoji}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-sm font-semibold">
                    {captureOpt.label}
                    {(captureOpt.stepType === "capture_conta" || captureOpt.stepType === "capture_documento") && (
                      <Badge variant="secondary" className="gap-1 text-[10px]">
                        <ScanLine className="h-3 w-3" /> lê sozinho
                      </Badge>
                    )}
                  </span>
                  <span className="block text-[11px] text-muted-foreground">Toque para escolher outro</span>
                </span>
                <span className="flex items-center gap-1 text-[11px] font-medium text-primary">
                  <ArrowLeft className="h-3 w-3" /> voltar
                </span>
              </button>
            )}

            {/* Edição da mensagem (quando há intenção definida) */}
            {(intent === "falar" || captureOpt) && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="g-titulo">Nome do passo (só pra você se achar)</Label>
                  <Input
                    id="g-titulo"
                    value={titulo}
                    onChange={(e) => setTitulo(e.target.value)}
                    placeholder={defaultTitleForType(stepType)}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="g-msg">
                    {intent === "pedir"
                      ? "Mensagem que eu mando ao pedir (opcional)"
                      : "O que o bot vai dizer aqui?"}
                  </Label>
                  {/* Chips de variável — inserem no cursor */}
                  <div className="flex flex-wrap gap-1">
                    {VARIAVEIS.map((v) => (
                      <button
                        key={v.token}
                        type="button"
                        onClick={() => inserirVariavel(v.token)}
                        className="rounded-full border bg-card px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-primary/10 hover:text-primary"
                        title={`Inserir ${v.token}`}
                      >
                        + {v.label}
                      </button>
                    ))}
                  </div>
                  <Textarea
                    id="g-msg"
                    ref={textareaRef}
                    value={mensagem}
                    onChange={(e) => setMensagem(e.target.value)}
                    rows={3}
                    placeholder={
                      intent === "pedir"
                        ? `Deixe em branco que eu uso meu texto padrão. Ex.: ${defaultPromptForType(stepType)}`
                        : "Ex.: Oi {{nome}}! Posso te mostrar como economizar até 20%?"
                    }
                  />
                </div>

                {/* Mídia: escolher QUAIS tipos e em que ORDEM (vira media_order) */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium">O que esse passo envia? (na ordem que tocar)</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {([
                      { kind: "text", label: "Texto", Icon: MessageCircle },
                      { kind: "audio", label: "Áudio", Icon: Mic },
                      { kind: "image", label: "Imagem", Icon: ImageIcon },
                      { kind: "video", label: "Vídeo", Icon: Video },
                    ] as const).map(({ kind, label, Icon }) => {
                      const pos = tiposMidia.indexOf(kind);
                      const ativo = pos >= 0;
                      return (
                        <button
                          key={kind}
                          type="button"
                          onClick={() =>
                            setTiposMidia((cur) =>
                              cur.includes(kind) ? cur.filter((k) => k !== kind) : [...cur, kind],
                            )
                          }
                          className={cn(
                            "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-all",
                            ativo
                              ? "border-primary bg-primary/10 text-primary"
                              : "bg-card text-muted-foreground hover:bg-primary/5",
                          )}
                        >
                          {ativo && (
                            <span className="grid h-4 w-4 place-items-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">
                              {pos + 1}
                            </span>
                          )}
                          <Icon className="h-3.5 w-3.5" />
                          {label}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {tiposMidia.length === 0
                      ? "Toque pra escolher. Pode ser só 1 (ex.: só áudio) ou vários numa sequência."
                      : tiposUpload.length > 0
                        ? "Ao criar o passo, abro a tela pra você enviar o(s) arquivo(s)."
                        : "Só texto neste passo."}
                  </p>
                </div>

                {/* Botões */}
                {aceitaBotoes && (
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Quer dar opções pro cliente tocar? (opcional)</Label>
                    <p className="text-[11px] text-muted-foreground">
                      Toque numa opção abaixo pra adicionar. No WhatsApp elas aparecem
                      numeradas (1, 2, 3) e o cliente responde com o número.
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {BUTTON_PRESETS.map((p) => {
                        const usado = botoes.some((b) => b.id === p.id);
                        return (
                          <button
                            key={p.id}
                            type="button"
                            disabled={usado}
                            onClick={() => addBotaoPreset(p)}
                            className="rounded-full border bg-card px-2.5 py-1 text-xs hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {p.emoji} {p.title}
                          </button>
                        );
                      })}
                    </div>
                    {botoes.length > 0 && (
                      <div className="space-y-2">
                        {botoes.map((b, i) => (
                          <div key={b.id} className="rounded-lg border bg-card p-2.5">
                            <div className="flex items-center gap-2">
                              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">
                                {i + 1}
                              </span>
                              <Input
                                value={b.title}
                                onChange={(e) =>
                                  setBotoes((cur) =>
                                    cur.map((x) => (x.id === b.id ? { ...x, title: e.target.value } : x)),
                                  )
                                }
                                className="h-8 text-sm"
                                placeholder="Texto do botão"
                              />
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-xs text-destructive"
                                onClick={() => removeBotao(b.id)}
                              >
                                remover
                              </Button>
                            </div>
                            <div className="mt-2 space-y-1">
                              <Label className="text-xs">Se o cliente tocar aqui, levo ele para:</Label>
                              <Select value={b.dest} onValueChange={(v) => setBotaoDest(b.id, v)}>
                                <SelectTrigger className="h-8 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {destOptions.map((d) => (
                                    <SelectItem key={d.value} value={d.value} className="text-xs">
                                      {d.emoji} {d.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {/* Ação: adicionar passo + explicação do que falta */}
            <div className="sticky bottom-0 -mx-5 mt-2 space-y-1.5 border-t border-white/15 bg-background/70 px-5 pb-1 pt-3 backdrop-blur-md dark:border-white/5">
              {motivoTravado && (
                <p className="text-[11px] text-muted-foreground">{motivoTravado}</p>
              )}
              <Button
                className="w-full"
                disabled={!rascunhoValido || salvando}
                onClick={adicionarPasso}
              >
                {salvando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                Adicionar este passo
              </Button>
            </div>
          </section>

          {/* COLUNA 3 — celular */}
          <aside className="hidden max-h-[70vh] overflow-y-auto border-l border-white/15 bg-white/5 p-4 backdrop-blur-sm md:block dark:border-white/5 dark:bg-white/[0.02]">
            <p className="mb-2 text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Como o cliente vê
            </p>
            <ConversationPreview
              steps={previewSteps}
              consultantName={consultantName}
              focusStepId={draftStep ? "__draft__" : null}
            />
            <p className="mt-2 text-center text-[10px] text-muted-foreground">
              Cliente fictício: João Silva · respostas simuladas
            </p>
          </aside>
        </div>

        {/* Rodapé */}
        <div className="flex items-center justify-between border-t border-white/15 bg-background/70 px-6 py-3 backdrop-blur-md dark:border-white/5">
          <span className="text-xs text-muted-foreground">
            {ordenados.length} {ordenados.length === 1 ? "passo criado" : "passos criados"}
          </span>
          <div className="flex items-center gap-2">
            {ordenados.length > 0 && onDeleteStep && (
              <Button
                variant="ghost"
                size="sm"
                disabled={salvando}
                onClick={() => {
                  const ultimo = ordenados[ordenados.length - 1];
                  if (ultimo) void onDeleteStep(ultimo.id);
                }}
              >
                <ArrowLeft className="mr-1 h-3 w-3" /> Desfazer último
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => setRevisando(true)}>
              Concluir <ArrowRight className="ml-1 h-3 w-3" />
            </Button>
          </div>
        </div>
        </>
        )}
      </DialogContent>
    </Dialog>
  );
}
