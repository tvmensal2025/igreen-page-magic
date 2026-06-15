// GuidedStepDialog — "Iris construtora" (PR-2).
//
// O QUE FAZ
// ---------
// Em vez de o consultor abrir um passo em branco e preencher campos técnicos,
// a Iris PERGUNTA em linguagem natural o que o passo precisa fazer e MONTA o
// bloco pronto: tipo, mensagem, botões e captura — já no formato que o runtime
// entende. É 100% DETERMINÍSTICA: não chama IA, não inventa schema. As opções
// que ela oferece SÃO o catálogo real (`STEP_TYPE_OPTIONS`) e os botões saem de
// `BUTTON_PRESETS`. O texto vira sugestão editável antes de salvar.
//
// POR QUE DETERMINÍSTICA
// ----------------------
// O problema "montar um passo" é fechado: um passo tem tipo + mensagem +
// (opcional) botões/captura + uma saída. Como o catálogo é finito e as regras
// de ligação já existem (`useFlowValidation`/`flowExits`), a Iris só precisa
// SEGUIR o mapa — não precisa de um LLM para adivinhar. Zero custo, nunca quebra
// o schema, resposta instantânea.
//
// DESTINO DOS BOTÕES (correção da auditoria — Opção A)
// ----------------------------------------------------
// Todo botão SEMPRE nasce com um destino EXPLÍCITO: "falar com atendente"
// (goto_special=humano), "ir para o cadastro" (goto_special=cadastro) ou um
// PASSO JÁ EXISTENTE (goto_step_id). Cada botão vira uma transition no MESMO
// formato do `StepInspector.setButtonGoto` (trigger_intent="palavra_chave",
// trigger_phrases=[título, título sem emoji, id]).
//
// Por que NÃO existe a opção "continuar no fluxo / próximo passo": o passo é
// criado no FIM do fluxo, então "o próximo" ainda não existe. Sem transition, o
// clique cai no fallback `repeat` do runtime (engine/fallbacks.ts) e REPETE a
// mensagem em loop até estourar o limite e jogar pra humano — o oposto do que
// um rótulo "próximo passo" prometeria. Por isso exigimos destino explícito; o
// consultor reordena/religa os passos depois, no inspetor.

import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
  ArrowLeft,
  ArrowRight,
  Check,
  GraduationCap,
  Loader2,
  MousePointerClick,
} from "lucide-react";
import {
  STEP_TYPE_OPTIONS,
  BUTTON_PRESETS,
  type Step,
  type Transition,
  type Capture,
  type IconKey,
} from "./flowTypes";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Cria o passo (geralmente o `addStep` do useFlowStepsCrud). */
  onCreate: (seed: Partial<Step>) => Promise<Step | null>;
  /** Passos já existentes no fluxo — viram destinos possíveis dos botões. */
  steps: Step[];
  /** Nome do consultor, para a Iris personalizar a saudação. */
  consultantName?: string;
}

/** Ícone padrão por tipo de passo (espelha o uso no resto do construtor). */
function iconForType(stepType: string): IconKey {
  switch (stepType) {
    case "capture_conta":
    case "capture_documento":
      return "file";
    case "capture_email":
    case "confirm_phone":
      return "user";
    case "finalizar_cadastro":
      return "sparkle";
    default:
      return "msg";
  }
}

/**
 * Um botão sendo montado no assistente. `dest` segue o MESMO formato de valor
 * do `StepInspector` ("special:humano" | "special:cadastro" | "step:<id>"),
 * garantindo paridade total com o `setButtonGoto`.
 */
interface DraftButton {
  id: string;
  title: string;
  dest: string;
}

/** Destinos fixos (não dependem de nenhum passo existir). */
const DEST_HUMANO = "special:humano";
const DEST_CADASTRO = "special:cadastro";

/** Entrada pura para montar o seed do passo — espelha o estado do diálogo. */
export interface GuidedStepInput {
  stepType: string;
  titulo: string;
  mensagem: string;
  botoes: DraftButton[];
}

/**
 * Converte o valor de destino do botão ("special:humano" | "special:cadastro"
 * | "step:<id>") no par (goto_step_id, goto_special) que o runtime entende.
 * Espelha exatamente o `StepInspector.setButtonGoto`.
 */
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
 * Extraída do componente para ser testável de forma isolada (trava o formato
 * das transitions/captures contra regressões — ver __tests__).
 *
 * Garantia central (correção da auditoria — Opção A): para cada botão é criada
 * UMA transition com destino EXPLÍCITO (goto_step_id OU goto_special sempre
 * preenchido), no mesmo formato do `StepInspector.setButtonGoto`. Nenhum botão
 * fica sem regra, então o runtime nunca cai no fallback `repeat` por clique.
 */
export function buildGuidedStepSeed(input: GuidedStepInput): Partial<Step> {
  const { stepType, titulo, mensagem, botoes } = input;
  const tipoMeta =
    STEP_TYPE_OPTIONS.find((o) => o.value === stepType) ?? STEP_TYPE_OPTIONS[0];
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
    title: titulo.trim() || tipoMeta.label,
    message_text: mensagem.trim(),
    icon: iconForType(stepType),
    transitions,
    captures,
    fallback: { mode: "repeat" },
  };
}

export default function GuidedStepDialog({
  open,
  onOpenChange,
  onCreate,
  steps,
  consultantName,
}: Props) {
  // Passo do assistente: 1) o que faz · 2) mensagem · 3) botões · 4) revisão.
  const [etapa, setEtapa] = useState(1);
  const [stepType, setStepType] = useState<string>("message");
  const [titulo, setTitulo] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [botoes, setBotoes] = useState<DraftButton[]>([]);
  const [salvando, setSalvando] = useState(false);

  const primeiroNome =
    (consultantName && consultantName.trim().split(/\s+/)[0]) || null;

  const tipoMeta = useMemo(
    () => STEP_TYPE_OPTIONS.find((o) => o.value === stepType) ?? STEP_TYPE_OPTIONS[0],
    [stepType],
  );

  // Destinos possíveis de um botão: os dois fixos + cada passo ativo existente.
  // Todos são EXPLÍCITOS — nunca um "próximo" que ainda não existe.
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

  function destLabel(dest: string): string {
    const d = destOptions.find((x) => x.value === dest);
    return d ? `${d.emoji} ${d.label}` : "destino";
  }

  // Captura (conta/documento/email) não usa botões: o passo espera um envio do
  // cliente, não uma escolha. Só "message"/"confirm_phone"/"finalizar" fazem
  // sentido com botões.
  const aceitaBotoes = stepType === "message" || stepType === "confirm_phone" || stepType === "finalizar_cadastro";

  function reset() {
    setEtapa(1);
    setStepType("message");
    setTitulo("");
    setMensagem("");
    setBotoes([]);
    setSalvando(false);
  }

  function fechar() {
    reset();
    onOpenChange(false);
  }

  function addBotaoPreset(preset: (typeof BUTTON_PRESETS)[number]) {
    if (botoes.some((b) => b.id === preset.id)) return;
    // Destino inicial explícito: "humano" cai em atendente; o resto começa
    // apontando pro cadastro (destino seguro). O consultor ajusta no seletor.
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

  /** Delega para a função pura `buildGuidedStepSeed` (testável e sem estado). */
  function montarSeed(): Partial<Step> {
    return buildGuidedStepSeed({ stepType, titulo, mensagem, botoes });
  }

  async function confirmar() {
    setSalvando(true);
    const created = await onCreate(montarSeed());
    setSalvando(false);
    if (created) fechar();
    // Em erro, o onCreate já mostrou o toast; mantém o dialog aberto p/ retry.
  }

  const podeAvancar1 = !!stepType;
  const podeAvancar2 = mensagem.trim().length > 0 || stepType.startsWith("capture_");

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) fechar(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GraduationCap className="h-5 w-5 text-primary" />
            Montar passo com a Iris
          </DialogTitle>
          <DialogDescription>
            {primeiroNome ? `${primeiroNome}, eu` : "Eu"} te pergunto o que esse passo
            precisa fazer e já deixo ele pronto pra você revisar e encaixar no fluxo.
          </DialogDescription>
        </DialogHeader>

        {/* Indicador de etapas */}
        <div className="flex items-center justify-center gap-1.5">
          {[1, 2, 3, 4].map((n) => (
            <span
              key={n}
              className={cn(
                "h-1.5 rounded-full transition-all",
                n === etapa ? "w-5 bg-primary" : n < etapa ? "w-1.5 bg-primary/40" : "w-1.5 bg-border",
              )}
            />
          ))}
        </div>

        <div className="min-h-[240px] space-y-4 py-1">
          {/* ETAPA 1 — o que o passo faz */}
          {etapa === 1 && (
            <div className="space-y-3">
              <p className="text-sm font-medium">O que esse passo faz?</p>
              <div className="grid grid-cols-1 gap-1.5">
                {STEP_TYPE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setStepType(opt.value)}
                    className={cn(
                      "flex items-start gap-2 rounded-lg border p-2.5 text-left transition-all hover:border-primary/50",
                      stepType === opt.value && "border-primary bg-primary/5 ring-2 ring-primary/20",
                    )}
                  >
                    <span className="text-lg">{opt.emoji}</span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{opt.label}</p>
                      <p className="text-xs text-muted-foreground">{opt.hint}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ETAPA 2 — mensagem */}
          {etapa === 2 && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="g-titulo">Nome do passo (só pra você se achar)</Label>
                <Input
                  id="g-titulo"
                  value={titulo}
                  onChange={(e) => setTitulo(e.target.value)}
                  placeholder={tipoMeta.label}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="g-msg">O que o bot vai dizer aqui?</Label>
                <Textarea
                  id="g-msg"
                  value={mensagem}
                  onChange={(e) => setMensagem(e.target.value)}
                  rows={4}
                  placeholder={
                    stepType.startsWith("capture_")
                      ? "Ex.: Me envia uma foto da sua conta de luz 📸 (opcional aqui)"
                      : "Ex.: Oi {{nome}}! Posso te mostrar como economizar até 20%?"
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Dá pra usar <code className="rounded bg-muted px-1">{"{{nome}}"}</code>,{" "}
                  <code className="rounded bg-muted px-1">{"{{valor_conta}}"}</code>,{" "}
                  <code className="rounded bg-muted px-1">{"{{representante}}"}</code>.
                </p>
              </div>
            </div>
          )}

          {/* ETAPA 3 — botões (quando faz sentido) */}
          {etapa === 3 && (
            <div className="space-y-3">
              {aceitaBotoes ? (
                <>
                  <p className="text-sm font-medium">
                    Quer oferecer botões pro cliente escolher? (opcional)
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

                  {botoes.length === 0 ? (
                    <div className="rounded-lg border border-dashed bg-muted/20 p-3 text-center text-xs text-muted-foreground">
                      Sem botões — o cliente responde escrevendo. Você pode adicionar acima.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {botoes.map((b) => (
                        <div key={b.id} className="rounded-lg border bg-card p-2.5">
                          <div className="flex items-center gap-2">
                            <MousePointerClick className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <Input
                              value={b.title}
                              onChange={(e) =>
                                setBotoes((cur) =>
                                  cur.map((x) => (x.id === b.id ? { ...x, title: e.target.value } : x)),
                                )
                              }
                              className="h-8 text-sm"
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
                            <Label className="text-xs">Quando clicar, vai para:</Label>
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
                </>
              ) : (
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm text-muted-foreground">
                  Esse tipo de passo espera um envio do cliente (foto, e-mail…),
                  então não usa botões. Pode seguir para a revisão.
                </div>
              )}
            </div>
          )}

          {/* ETAPA 4 — revisão */}
          {etapa === 4 && (
            <div className="space-y-3">
              <p className="text-sm font-medium">Tudo certo? É isso que vou criar:</p>
              <div className="space-y-2 rounded-lg border bg-muted/20 p-3 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{tipoMeta.emoji}</span>
                  <span className="font-medium">{titulo.trim() || tipoMeta.label}</span>
                  <Badge variant="outline" className="text-[10px]">{tipoMeta.label}</Badge>
                </div>
                {mensagem.trim() && (
                  <p className="whitespace-pre-wrap rounded bg-background/60 p-2 text-xs text-muted-foreground">
                    {mensagem.trim()}
                  </p>
                )}
                {aceitaBotoes && botoes.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {botoes.map((b) => (
                      <span
                        key={b.id}
                        className="inline-flex items-center gap-1 rounded-full border bg-card px-2 py-0.5 text-[11px]"
                        title={`vai para: ${destLabel(b.dest)}`}
                      >
                        {b.title} <ArrowRight className="h-2.5 w-2.5" /> {destLabel(b.dest)}
                      </span>
                    ))}
                  </div>
                )}
                <p className="text-[11px] text-muted-foreground">
                  O passo entra no fim do fluxo e cada botão já vai pro destino que
                  você escolheu. Dá pra reordenar e reajustar os destinos depois, no passo.
                </p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex items-center justify-between gap-2 sm:justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => (etapa === 1 ? fechar() : setEtapa((e) => e - 1))}
            disabled={salvando}
          >
            {etapa === 1 ? "Cancelar" : (<><ArrowLeft className="mr-1 h-3 w-3" /> Voltar</>)}
          </Button>

          {etapa < 4 ? (
            <Button
              size="sm"
              onClick={() => setEtapa((e) => e + 1)}
              disabled={(etapa === 1 && !podeAvancar1) || (etapa === 2 && !podeAvancar2)}
            >
              Próximo <ArrowRight className="ml-1 h-3 w-3" />
            </Button>
          ) : (
            <Button size="sm" onClick={confirmar} disabled={salvando}>
              {salvando ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Check className="mr-1 h-3 w-3" />}
              Criar passo
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
