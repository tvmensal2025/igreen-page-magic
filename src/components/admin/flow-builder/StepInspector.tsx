import { useState, useEffect } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Plus, Trash2, ScanLine, Sparkles, Maximize2, Minimize2, HelpCircle, AlertTriangle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import StepMediaPanel from "@/components/admin/fluxo/StepMediaPanel";
import StepSuggestions from "./StepSuggestions";
import InlineAiButton from "./InlineAiButton";
import {
  Step, Transition, Capture, Variant, BUTTON_PRESETS, STEP_TYPE_OPTIONS, getButtons, isOcrStep, isAiAnswerStep,
} from "./flowTypes";
import { supabase } from "@/integrations/supabase/client";

const VOICE_SOFIA = "EJV7H2baGt5ab95tOoSG";

function MakeCallClipBinder({
  consultantId,
  clipId,
  personalize,
  onClipChange,
  onPersonalizeChange,
}: {
  consultantId: string;
  clipId: string | null;
  personalize: boolean;
  onClipChange: (id: string | null) => void;
  onPersonalizeChange: (v: boolean) => void;
}) {
  const [clips, setClips] = useState<
    Array<{ id: string; name: string | null; velip_audio_id: string | null; is_call_body: boolean | null; voice_id: string | null }>
  >([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("voice_audio_clips")
        .select("id, name, velip_audio_id, is_call_body, voice_id")
        .eq("consultant_id", consultantId)
        .order("updated_at", { ascending: false })
        .limit(50);
      if (cancelled) return;
      const list = (data || []).slice().sort((a: any, b: any) => {
        const score = (c: any) =>
          (c.voice_id === VOICE_SOFIA ? 4 : 0) +
          (c.is_call_body ? 2 : 0) +
          (c.velip_audio_id ? 1 : 0);
        return score(b) - score(a);
      });
      setClips(list as any);
    })();
    return () => { cancelled = true; };
  }, [consultantId]);

  return (
    <div className="space-y-2 rounded-lg border border-border/70 bg-muted/20 p-3">
      <Label className="text-sm">Áudio Sofia da ligação</Label>
      <Select
        value={clipId || "__none__"}
        onValueChange={(v) => onClipChange(v === "__none__" ? null : v)}
      >
        <SelectTrigger>
          <SelectValue placeholder="Selecione o clip" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">Nenhum (obrigatório para ligar)</SelectItem>
          {clips.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {(c.name || c.id.slice(0, 8)) +
                (c.voice_id === VOICE_SOFIA ? " · Sofia" : "") +
                (c.is_call_body ? " · corpo" : "") +
                (c.velip_audio_id ? " · iGreen Fone" : "")}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex items-start gap-2">
        <Switch checked={personalize} onCheckedChange={onPersonalizeChange} id="make-call-pers" className="mt-0.5" />
        <div>
          <Label htmlFor="make-call-pers" className="text-xs">Personalizar com nome</Label>
          <p className="text-[11px] text-muted-foreground">
            Costura &quot;Olá, {"{Nome}"}.&quot; (só gasta ElevenLabs se não houver cache).
          </p>
        </div>
      </div>
      <p className="text-[11px] text-amber-700 dark:text-amber-300">
        Runtime fail-closed: sem <code>bot_global_enabled</code> + toggle{" "}
        <code>bot_flow_make_call</code> só registra dry-run (não disca).
      </p>
    </div>
  );
}

interface Props {
  step: Step | null;
  steps: Step[];
  consultantId: string;
  variant: Variant;
  flowId?: string | null;
  maxPosition?: number;
  /** Aba aberta ao montar o inspetor. Default "conteudo". */
  initialTab?: "conteudo" | "regras" | "midias" | "avancado";
  onClose: () => void;
  onPatch: (patch: Partial<Step>) => void;
  onReload?: () => void;
}

/**
 * Drawer lateral pra editar UM passo. Esconde tudo que é avançado atrás
 * da aba "Avançado" pra um leigo nunca precisar abrir.
 */
export default function StepInspector({
  step, steps, consultantId, variant, flowId, maxPosition, initialTab = "conteudo", onClose, onPatch, onReload,
}: Props) {
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  // Aba ativa controlada. Re-sincroniza com `initialTab` sempre que o passo
  // editado muda (ex.: abrir outro passo direto na aba "Regras & Botões"
  // a partir do link "editar" das Saídas na Lista).
  const [activeTab, setActiveTab] = useState<string>(initialTab);
  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab, step?.id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.rpc("is_super_admin", { _user_id: user.id });
      if (!cancelled) setIsSuperAdmin(Boolean(data));
    })();
    return () => { cancelled = true; };
  }, []);

  if (!step) return null;
  const buttons = getButtons(step);

  const tabHelp = (text: string) => (
    <Popover>
      <PopoverTrigger asChild>
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => e.stopPropagation()}
          className="inline-flex text-muted-foreground/60 hover:text-primary"
          aria-label="Ajuda"
        >
          <HelpCircle className="h-3 w-3" />
        </span>
      </PopoverTrigger>
      <PopoverContent side="bottom" className="w-64 text-xs">{text}</PopoverContent>
    </Popover>
  );

  function setButtons(next: { id: string; title: string }[]) {
    const others = step!.captures.filter((c) => c.field !== "_buttons");
    const updated: Capture[] = next.length
      ? [...others, { field: "_buttons", enabled: true, value: next } as Capture]
      : others;
    onPatch({ captures: updated });
  }

  function addButton(preset: typeof BUTTON_PRESETS[number]) {
    const exists = buttons.some((b) => b.id === preset.id);
    if (exists) return;
    setButtons([...buttons, { id: preset.id, title: `${preset.emoji} ${preset.title}` }]);
  }

  function setButtonGoto(buttonId: string, value: string) {
    // value formato: "step:<id>" | "special:humano" | "special:cadastro" | "none"
    const others = step!.transitions.filter(
      (t) => t.trigger_intent !== buttonId && !t.trigger_phrases.some((p) => p === buttonId),
    );
    let next: Transition[] = others;
    const btn = buttons.find((b) => b.id === buttonId);
    if (btn && value !== "none") {
      const t: Transition = {
        trigger_intent: "palavra_chave",
        trigger_phrases: [btn.title, btn.title.replace(/^\S+\s/, "").trim(), buttonId],
        goto_step_id: value.startsWith("step:") ? value.slice(5) : null,
        goto_special: value.startsWith("special:") ? (value.slice(8) as any) : null,
      };
      next = [...others, t];
    }
    onPatch({ transitions: next });
  }

  function getButtonGoto(buttonId: string): string {
    const btn = buttons.find((b) => b.id === buttonId);
    if (!btn) return "none";
    // Busca por buttonId primeiro (mais específico), depois por título.
    // Evita que dois botões com títulos similares retornem a transição errada.
    const t = step!.transitions.find(
      (x) =>
        x.trigger_intent === buttonId ||
        x.trigger_phrases.includes(buttonId) ||
        x.trigger_phrases.includes(btn.title) ||
        // Título sem emoji (ex: "Quero simular" de "📸 Quero simular")
        x.trigger_phrases.includes(btn.title.replace(/^\S+\s/, "").trim()),
    );
    if (!t) return "none";
    if (t.goto_special) return `special:${t.goto_special}`;
    if (t.goto_step_id) return `step:${t.goto_step_id}`;
    return "none";
  }

  return (
    <Sheet open={!!step} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent
        side="right"
        className={cn(
          "overflow-y-auto transition-[max-width] duration-200",
          fullscreen ? "w-screen sm:max-w-[100vw]" : "w-full sm:max-w-[520px]",
        )}
      >
        <SheetHeader>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <SheetTitle>Editar passo #{step.position}</SheetTitle>
              <SheetDescription>
                Mudanças são salvas automaticamente. Veja o preview do WhatsApp ao lado.
              </SheetDescription>
            </div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-8 w-8 shrink-0"
              onClick={() => setFullscreen((v) => !v)}
              aria-label={fullscreen ? "Reduzir" : "Tela cheia"}
              title={fullscreen ? "Reduzir" : "Tela cheia"}
            >
              {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
          </div>
        </SheetHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-4 min-w-0">
          <div className="w-full max-w-full min-w-0 overflow-x-auto overscroll-x-contain">
            <TabsList className="inline-flex h-auto w-max max-w-none gap-0.5 sm:grid sm:w-full sm:grid-cols-4 sm:min-w-0">
              <TabsTrigger value="conteudo" className="shrink-0 text-xs sm:text-sm">
                <span className="flex items-center gap-1">Conteúdo {tabHelp("O texto que o bot envia. Use {{nome}} pra personalizar.")}</span>
              </TabsTrigger>
              <TabsTrigger value="regras" className="shrink-0 text-xs sm:text-sm">
                <span className="flex items-center gap-1">Regras {tabHelp("Botões e palavras-chave que decidem o próximo passo do cliente.")}</span>
              </TabsTrigger>
              <TabsTrigger value="midias" className="shrink-0 text-xs sm:text-sm">
                <span className="flex items-center gap-1">Mídia {tabHelp("Áudio, imagem ou vídeo que acompanha o texto. Escolha do seu acervo.")}</span>
              </TabsTrigger>
              <TabsTrigger value="avancado" className="shrink-0 text-xs sm:text-sm">
                <span className="flex items-center gap-1">Avançado {tabHelp("Ajustes técnicos: chave do passo, fallback de IA, OCR. Só mexa se souber.")}</span>
              </TabsTrigger>
            </TabsList>
          </div>


          {/* CONTEÚDO */}
          <TabsContent value="conteudo" className="space-y-4 pt-4">
            {isAiAnswerStep(step) && (
              <div className="space-y-2 rounded-lg border border-primary/40 bg-primary/10 p-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  <Label className="text-sm">Este passo usa IA livre (Gemini)</Label>
                </div>
                <p className="text-xs text-muted-foreground">
                  O texto que você digitar abaixo é <strong>ignorado</strong>. O bot responde cada pergunta do cliente interessado com Gemini + a sua FAQ. Para o cliente interessado sair desse passo, ele precisa clicar em <strong>um dos botões</strong> (ex: "Quero simular", "Falar com humano"). Sem botões, vira loop infinito.
                </p>
                {(() => {
                  const btns = getButtons(step);
                  if (btns.length > 0) return null;
                  return (
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full"
                      onClick={() => {
                        const target = steps.find(
                          (s) => /capture_(conta|documento)/.test(s.step_type) || /pedir_(conta|documento)/i.test(s.step_key ?? "") || /conta|fatura|luz/i.test(s.step_key ?? ""),
                        );
                        const defaults: { id: string; title: string }[] = [
                          { id: "simular", title: "📸 Quero simular" },
                          { id: "humano", title: "👤 Falar com humano" },
                        ];
                        const newTrans: Transition[] = [
                          {
                            trigger_intent: "palavra_chave",
                            trigger_phrases: ["📸 Quero simular", "Quero simular", "simular"],
                            goto_step_id: target?.id ?? null,
                            goto_special: target ? null : "cadastro",
                          },
                          {
                            trigger_intent: "palavra_chave",
                            trigger_phrases: ["👤 Falar com humano", "Falar com humano", "humano"],
                            goto_step_id: null,
                            goto_special: "humano",
                          },
                        ];
                        const others = step.captures.filter((c) => c.field !== "_buttons");
                        onPatch({
                          captures: [...others, { field: "_buttons", enabled: true, value: defaults } as Capture],
                          transitions: [...step.transitions, ...newTrans],
                        });
                      }}
                    >
                      ✨ Adicionar saídas padrão (simular + humano)
                    </Button>
                  );
                })()}
              </div>
            )}


            <div className="space-y-1.5">
              <Label htmlFor="title">Nome do passo</Label>
              <Input
                id="title"
                value={step.title}
                onChange={(e) => onPatch({ title: e.target.value })}
              />
            </div>

            <div className="space-y-1.5">
              <Label>O que esse passo faz?</Label>
              <Select value={step.step_type} onValueChange={(v) => onPatch({ step_type: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STEP_TYPE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.emoji} {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {STEP_TYPE_OPTIONS.find((o) => o.value === step.step_type)?.hint}
              </p>
            </div>

            {step.step_type === "make_call" && (
              <MakeCallClipBinder
                consultantId={consultantId}
                clipId={step.voice_audio_clip_id ?? null}
                personalize={!!step.personalize_name}
                onClipChange={(id) => onPatch({ voice_audio_clip_id: id })}
                onPersonalizeChange={(v) => onPatch({ personalize_name: v })}
              />
            )}

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="msg">Mensagem de texto</Label>
                <InlineAiButton
                  text={step.message_text ?? ""}
                  context={`Mensagem do passo "${step.title}"`}
                  onResult={(next) => onPatch({ message_text: next })}
                />
              </div>
              <Textarea
                id="msg"
                value={step.message_text ?? ""}
                onChange={(e) => onPatch({ message_text: e.target.value })}
                placeholder="Digite o texto que o bot vai enviar…"
                rows={4}
              />
              <p className="text-xs text-muted-foreground">
                Variáveis disponíveis:{" "}
                <code className="rounded bg-muted px-1" title="{{nome}}">nome do cliente</code>,{" "}
                <code className="rounded bg-muted px-1" title="{{valor_conta}}">valor da conta</code>,{" "}
                <code className="rounded bg-muted px-1" title="{{representante}}">nome do consultor</code>,{" "}
                <code className="rounded bg-muted px-1" title="{{economia_mensal}}">economia/mês</code>,{" "}
                <code className="rounded bg-muted px-1" title="{{economia_anual}}">economia/ano</code>
              </p>
            </div>


            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label className="text-sm">Passo ativo</Label>
                <p className="text-xs text-muted-foreground">
                  Se desligado, o bot pula este passo.
                </p>
              </div>
              <Switch
                checked={step.is_active}
                onCheckedChange={(v) => onPatch({ is_active: v })}
              />
            </div>

            {/* PRÓXIMO PASSO (fallback default) */}
            {(() => {
              const sortedSteps = [...steps].sort((a, b) => a.position - b.position);
              const nextByOrder = sortedSteps.find((s) => s.position > step.position && s.is_active);
              const defaultTransition = step.transitions.find((t) => t.trigger_intent === "default");
              const fb = step.fallback ?? { mode: "repeat" };

              let current = "order";
              if (defaultTransition?.goto_special === "humano") current = "humano";
              else if (fb.mode === "goto" && fb.goto_step_id) current = `step:${fb.goto_step_id}`;
              else if (defaultTransition?.goto_step_id) current = `step:${defaultTransition.goto_step_id}`;
              else if (defaultTransition?.goto_special === "repeat") current = "repeat";
              else current = "order";

              const handleChange = (value: string) => {
                const others = step.transitions.filter((t) => t.trigger_intent !== "default");
                if (value === "order") {
                  onPatch({
                    fallback: { mode: "repeat" } as any,
                    transitions: others,
                  });
                } else if (value === "repeat") {
                  onPatch({
                    fallback: { mode: "repeat" } as any,
                    transitions: [
                      ...others,
                      { trigger_intent: "default", trigger_phrases: [], goto_step_id: null, goto_special: "repeat" } as Transition,
                    ],
                  });
                } else if (value === "humano") {
                  onPatch({
                    fallback: { mode: "repeat" } as any,
                    transitions: [
                      ...others,
                      { trigger_intent: "default", trigger_phrases: [], goto_step_id: null, goto_special: "humano" } as Transition,
                    ],
                  });
                } else if (value.startsWith("step:")) {
                  const id = value.slice(5);
                  onPatch({
                    fallback: { mode: "goto", goto_step_id: id } as any,
                    transitions: [
                      ...others,
                      { trigger_intent: "default", trigger_phrases: [], goto_step_id: id, goto_special: null } as Transition,
                    ],
                  });
                }
              };

              return (
                <div className="space-y-1.5 rounded-lg border border-info/30 bg-info/5 p-3">
                  <Label className="text-sm">O que fazer se o cliente não responder</Label>
                  <p className="text-xs text-muted-foreground">
                    Quando o cliente não clica em botão nem manda mensagem, o bot
                    segue por aqui.
                  </p>
                  <Select value={current} onValueChange={handleChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="order">
                        ➡ Ir para o próximo passo sem esperar{nextByOrder ? ` (#${nextByOrder.position} ${nextByOrder.title})` : " (fim do fluxo)"}
                      </SelectItem>
                      <SelectItem value="repeat">⏳ Esperar e repetir a mensagem (recomendado para perguntas)</SelectItem>
                      <SelectItem value="humano">👤 Encerrar / falar com humano</SelectItem>
                      {sortedSteps
                        .filter((s) => s.id !== step.id)
                        .map((s) => (
                          <SelectItem key={s.id} value={`step:${s.id}`}>
                            Ir para: #{s.position} {s.title}{!s.is_active ? " (inativo)" : ""}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  {current === "order" && (
                    <div className="mt-1.5 flex items-start gap-1.5 rounded-md bg-warning/10 p-2 text-[11px] text-warning-foreground dark:text-warning">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>
                        Atenção: com esta opção o bot <strong>não espera a resposta</strong> e
                        já manda o próximo passo. Se este passo faz uma pergunta
                        (ex.: "qual o valor da sua conta?"), o cliente vai receber
                        várias mensagens seguidas sem chance de responder. Para
                        perguntas, use <strong>"Esperar e repetir"</strong>.
                      </span>
                    </div>
                  )}
                </div>
              );
            })()}

            {(() => {
              const ocr = isOcrStep(step);
              if (!ocr) return null;
              const on = step.auto_detect_doc_type !== false;
              return (
                <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <ScanLine className="h-4 w-4 text-primary" />
                      <Label className="text-sm">Leitura automática</Label>
                    </div>
                    <Switch
                      checked={on}
                      onCheckedChange={(v) => onPatch({ auto_detect_doc_type: v } as any)}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {ocr === "conta" ? (
                      <>Quando o cliente enviar a foto, o bot extrai automaticamente <strong>valor da conta</strong>, <strong>nome</strong> e <strong>endereço</strong>.</>
                    ) : (
                      <>O bot tenta identificar <strong>RG ou CNH</strong> e extrai <strong>nome</strong>, <strong>CPF</strong> e <strong>data de nascimento</strong>.</>
                    )}
                    {" "}Os dados ficam disponíveis no próximo passo como <code className="rounded bg-muted px-1">{"{{valor_conta}}"}</code>, <code className="rounded bg-muted px-1">{"{{nome}}"}</code>, <code className="rounded bg-muted px-1">{"{{cpf}}"}</code>.
                  </p>
                  {!on && (
                    <p className="text-xs text-warning dark:text-warning">
                      ⚠ OCR desligado — o bot só vai salvar a foto, sem ler os dados.
                    </p>
                  )}
                </div>
              );
            })()}

            {isAiAnswerStep(step) && (() => {
              const fb = (step.fallback ?? {}) as any;
              const isLimit = fb.mode === "ai_limit";
              const max = isLimit ? Number(fb.max_questions ?? 3) : 3;
              const then = isLimit ? (fb.then ?? "humano") : "humano";
              return (
                <div className="space-y-2 rounded-lg border p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-sm">Limite de IA</Label>
                      <p className="text-xs text-muted-foreground">Evita loop infinito de perguntas.</p>
                    </div>
                    <Switch
                      checked={isLimit}
                      onCheckedChange={(v) =>
                        onPatch({
                          fallback: v
                            ? ({ mode: "ai_limit", max_questions: max, then } as any)
                            : ({ mode: "repeat" } as any),
                        })
                      }
                    />
                  </div>
                  {isLimit && (
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Após X perguntas</Label>
                        <Input
                          type="number"
                          min={1}
                          max={20}
                          value={max}
                          onChange={(e) =>
                            onPatch({
                              fallback: { mode: "ai_limit", max_questions: Math.max(1, Number(e.target.value) || 3), then } as any,
                            })
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Faz o quê?</Label>
                        <Select
                          value={then}
                          onValueChange={(v) =>
                            onPatch({
                              fallback: { mode: "ai_limit", max_questions: max, then: v as any } as any,
                            })
                          }
                        >
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="humano">👤 Falar com humano</SelectItem>
                            <SelectItem value="next">⏭ Avançar próximo passo</SelectItem>
                            <SelectItem value="repeat">🔁 Continuar respondendo</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}




            {flowId && (
              <div className="rounded-lg border bg-muted/10 p-3">
                <StepSuggestions
                  consultantId={consultantId}
                  stepId={step.id}
                  flowId={flowId}
                  currentMaxPosition={maxPosition ?? step.position}
                  onAdded={() => onReload?.()}
                />
              </div>
            )}

          </TabsContent>

          {/* MÍDIA */}
          <TabsContent value="midias" className="pt-4">
            {step.slot_key ? (
              <StepMediaPanel
                consultantId={consultantId}
                stepKey={step.step_key ?? ""}
                slotKeys={[step.slot_key]}
                messageText={step.message_text ?? ""}
                onMessageTextChange={(next) => onPatch({ message_text: next })}
                variant={variant}
                initialOrder={
                  Array.isArray(step.media_order) && step.media_order.length
                    ? (step.media_order as ("audio" | "image" | "video" | "text")[])
                    : undefined
                }
              />
            ) : (
              <div className="rounded-lg border border-dashed bg-muted/20 p-6 text-center text-sm text-muted-foreground">
                Configure uma <strong>chave de mídia</strong> na aba
                <br />
                <strong>Avançado</strong> para anexar arquivos a este passo.
              </div>
            )}
          </TabsContent>

          {/* REGRAS & BOTÕES (unificado) */}
          <TabsContent value="regras" className="space-y-5 pt-4">
            {/* — Botões — */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold">Botões interativos</Label>
                <Badge variant="outline" className="text-[10px]">{buttons.length}</Badge>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Adicionar pronto:</p>
                <div className="flex flex-wrap gap-1.5">
                  {BUTTON_PRESETS.map((p) => {
                    const used = buttons.some((b) => b.id === p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        disabled={used}
                        onClick={() => addButton(p)}
                        className="rounded-full border bg-card px-2.5 py-1 text-xs hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {p.emoji} {p.title}
                      </button>
                    );
                  })}
                </div>
              </div>

              {buttons.length === 0 && (
                <div className="rounded-lg border border-dashed bg-muted/20 p-3 text-center text-xs text-muted-foreground">
                  Sem botões. Use os presets acima ou deixe o bot esperar texto livre.
                </div>
              )}

              {buttons.length > 0 && (
                <div className="space-y-2">
                  {buttons.map((b, i) => (
                    <div key={b.id} className="rounded-lg border bg-card p-3">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="text-xs">{i + 1}</Badge>
                        <Input
                          value={b.title}
                          onChange={(e) => {
                            const next = [...buttons];
                            next[i] = { ...b, title: e.target.value };
                            setButtons(next);
                          }}
                          className="h-8 text-sm"
                        />
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="Remover botão"
                          title="Remover botão"
                          className="h-7 w-7 text-destructive"
                          onClick={() => setButtons(buttons.filter((_, j) => j !== i))}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <div className="mt-2 space-y-1">
                        <Label className="text-xs">Quando clicar, vai para:</Label>
                        <Select
                          value={getButtonGoto(b.id)}
                          onValueChange={(v) => setButtonGoto(b.id, v)}
                        >
                          <SelectTrigger className="h-9">
                            <SelectValue placeholder="Escolher destino…" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">⚠ Sem destino</SelectItem>
                            <SelectItem value="special:ai">🤖 Responder com IA (Gemini)</SelectItem>
                            <SelectItem value="special:humano">👤 Falar com humano</SelectItem>
                            <SelectItem value="special:cadastro">📝 Pular para cadastro</SelectItem>
                            {steps
                              .filter((s) => s.id !== step.id && s.is_active)
                              .sort((a, b2) => a.position - b2.position)
                              .map((s) => (
                                <SelectItem key={s.id} value={`step:${s.id}`}>
                                  #{s.position} {s.title}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() =>
                  setButtons([
                    ...buttons,
                    { id: `btn_${Date.now().toString(36)}`, title: "Novo botão" },
                  ])
                }
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                Botão personalizado
              </Button>
            </section>

            <div className="h-px bg-border" />

            {/* — Regras (palavras-chave) — */}
            <section className="space-y-3">
              <Label className="text-sm font-semibold">Regras por palavra-chave</Label>
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
                Palavras que o cliente interessado digita pra pular pra outro passo. Ex: <em>"humano"</em> → handoff.
              </div>
              {(() => {
                const buttonKeys = new Set(buttons.flatMap((b) => [b.id, b.title, b.title.replace(/^\S+\s/, "").trim()]));
                const ruleTransitions = step.transitions
                  .map((t, idx) => ({ t, idx }))
                  .filter(({ t }) => t.trigger_intent !== "default" && !t.trigger_phrases.some((p) => buttonKeys.has(p)) && !buttonKeys.has(t.trigger_intent));

                const updateTransition = (idx: number, patch: Partial<Transition>) => {
                  const next = step.transitions.map((t, i) => (i === idx ? { ...t, ...patch } : t));
                  onPatch({ transitions: next });
                };
                const removeTransition = (idx: number) => {
                  onPatch({ transitions: step.transitions.filter((_, i) => i !== idx) });
                };
                const addRule = () => {
                  onPatch({
                    transitions: [
                      ...step.transitions,
                      { trigger_intent: "palavra_chave", trigger_phrases: [""], goto_step_id: null, goto_special: null },
                    ],
                  });
                };
                const getGoto = (t: Transition): string => {
                  if (t.goto_special) return `special:${t.goto_special}`;
                  if (t.goto_step_id) return `step:${t.goto_step_id}`;
                  return "none";
                };
                const setGoto = (idx: number, value: string) => {
                  updateTransition(idx, {
                    goto_step_id: value.startsWith("step:") ? value.slice(5) : null,
                    goto_special: value.startsWith("special:") ? (value.slice(8) as any) : null,
                  });
                };

                return (
                  <>
                    {ruleTransitions.length === 0 && (
                      <div className="rounded-lg border border-dashed bg-muted/20 p-4 text-center text-xs text-muted-foreground">
                        Nenhuma regra. Clique em <strong>+ Nova regra</strong> abaixo.
                      </div>
                    )}

                    {ruleTransitions.map(({ t, idx }) => (
                      <div key={idx} className="space-y-2 rounded-lg border bg-card p-3">
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="text-xs">Regra {idx + 1}</Badge>
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label="Remover regra"
                            title="Remover regra"
                            className="ml-auto h-7 w-7 text-destructive"
                            onClick={() => removeTransition(idx)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Palavras-chave (separadas por vírgula)</Label>
                          <Input
                            className="h-9 text-sm"
                            value={t.trigger_phrases.join(", ")}
                            onChange={(e) =>
                              updateTransition(idx, {
                                trigger_phrases: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                              })
                            }
                            placeholder="ex: humano, atendente, falar com alguém"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Quando casar, vai para:</Label>
                          <Select value={getGoto(t)} onValueChange={(v) => setGoto(idx, v)}>
                            <SelectTrigger className="h-9">
                              <SelectValue placeholder="Escolher destino…" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">⚠ Sem destino</SelectItem>
                              <SelectItem value="special:ai">🤖 Responder com IA (Gemini)</SelectItem>
                              <SelectItem value="special:humano">👤 Falar com humano</SelectItem>
                              <SelectItem value="special:cadastro">📝 Pular para cadastro</SelectItem>
                              {steps
                                .filter((s) => s.id !== step.id && s.is_active)
                                .sort((a, b2) => a.position - b2.position)
                                .map((s) => (
                                  <SelectItem key={s.id} value={`step:${s.id}`}>
                                    #{s.position} {s.title}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    ))}

                    <Button variant="outline" size="sm" className="w-full" onClick={addRule}>
                      <Plus className="mr-1 h-3.5 w-3.5" />
                      Nova regra
                    </Button>
                  </>
                );
              })()}
            </section>
          </TabsContent>

          {/* AVANÇADO */}
          <TabsContent value="avancado" className="space-y-3 pt-4">
            {!isSuperAdmin ? (
              <div className="rounded-lg border border-dashed bg-muted/20 p-6 text-center text-sm text-muted-foreground">
                Configurações avançadas disponíveis apenas para <strong>SuperAdmin</strong>.
              </div>
            ) : (
              <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-semibold">Configurações técnicas</Label>
                  <Badge variant="outline" className="text-[10px]">SuperAdmin</Badge>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="key">Chave técnica (step_key)</Label>
                  <Input
                    id="key"
                    value={step.step_key ?? ""}
                    onChange={(e) => onPatch({ step_key: e.target.value || null })}
                  />
                  <p className="text-xs text-muted-foreground">
                    Usado pra identificar este passo nos relatórios. Mude com cuidado.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label>Slot de mídia (slot_key)</Label>
                  <Input
                    value={step.slot_key ?? ""}
                    onChange={(e) => onPatch({ slot_key: e.target.value || null })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Delay antes do texto (ms)</Label>
                  <Input
                    type="number"
                    min={0}
                    max={20000}
                    value={step.text_delay_ms ?? 0}
                    onChange={(e) => onPatch({ text_delay_ms: Number(e.target.value) || 0 })}
                  />
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

