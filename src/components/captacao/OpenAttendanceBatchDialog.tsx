import { useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CheckCircle2, Loader2, Mic, Image as ImageIcon, MessageSquare, Play, Square, RotateCcw, XCircle } from "lucide-react";
import { toast } from "sonner";

import type { MessageTemplate } from "@/types/whatsapp";
import type { CaptureBatchLead } from "@/components/captacao/CaptureLeadList";
import {
  runAttendanceBatch,
  hasValidBatchPhone,
  type BatchLeadResult,
} from "@/components/captacao/runAttendanceBatch";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  consultantId: string;
  instanceName: string;
  isWhapi: boolean;
  leads: CaptureBatchLead[];
  periodLabel: string;
  templates: MessageTemplate[];
  onFinished?: () => void;
}

const AVATAR_TONES = [
  "bg-primary/15 text-primary",
  "bg-info/15 text-info",
  "bg-warning/15 text-warning",
  "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
];
function toneFor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}
function initialsFrom(name: string | null, phone: string | null) {
  const src = (name || "").trim();
  if (src) {
    const parts = src.split(/\s+/);
    return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || "?";
  }
  return (phone || "?").replace(/\D/g, "").slice(-2) || "?";
}

function templateMediaUrl(t: MessageTemplate | undefined, kind: "audio" | "image"): string | null {
  if (!t || !t.id) return null;
  if (kind === "audio") {
    if (t.media_type === "audio" && t.media_url) return t.media_url;
    const item = (t.items || []).find((i) => i.message_type === "audio" && i.media_url);
    return item?.media_url || null;
  }
  if (t.media_type === "image") return t.media_url || t.image_url || null;
  if (t.image_url) return t.image_url;
  const item = (t.items || []).find((i) => i.message_type === "image" && (i.media_url || i.image_url));
  return item?.media_url || item?.image_url || null;
}

function templateTextContent(t: MessageTemplate | undefined): string {
  if (!t) return "";
  if (t.content && t.content.trim()) return t.content;
  const item = (t.items || []).find((i) => !!i.message_text);
  return item?.message_text || "";
}



function leadPill(lead: CaptureBatchLead, result?: BatchLeadResult) {
  if (result?.status === "running") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded-full">
        <Loader2 className="w-3 h-3 animate-spin" /> Enviando
      </span>
    );
  }
  if (result?.status === "ok") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded-full">
        <CheckCircle2 className="w-3 h-3" /> Ok
      </span>
    );
  }
  if (result?.status === "failed") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-destructive bg-destructive/10 px-2 py-0.5 rounded-full" title={result.detail}>
        <XCircle className="w-3 h-3" /> Falhou
      </span>
    );
  }
  if (result?.status === "skipped") {
    return (
      <span className="text-[10px] font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
        {result.detail || "Pulado"}
      </span>
    );
  }
  if (!hasValidBatchPhone(lead.phone_whatsapp)) {
    return (
      <span className="text-[10px] font-semibold text-destructive bg-destructive/10 px-2 py-0.5 rounded-full">
        Sem telefone
      </span>
    );
  }
  if (lead.welcome_sent_at) {
    return (
      <span className="text-[10px] font-semibold text-warning bg-warning/10 px-2 py-0.5 rounded-full">
        Já iniciado
      </span>
    );
  }
  return (
    <span className="text-[10px] font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded-full">
      Pronto
    </span>
  );
}

function mergeResults(
  allLeadIds: string[],
  prev: BatchLeadResult[],
  patch: BatchLeadResult[],
): BatchLeadResult[] {
  const map = new Map<string, BatchLeadResult>();
  for (const r of prev) map.set(r.id, r);
  for (const r of patch) map.set(r.id, r);
  return allLeadIds.map((id) => map.get(id) ?? { id, status: "pending" as const });
}

export function OpenAttendanceBatchDialog({
  open,
  onOpenChange,
  consultantId,
  instanceName,
  isWhapi,
  leads,
  periodLabel,
  templates,
  onFinished,
}: Props) {
  const [startAttendance, setStartAttendance] = useState(true);
  const [audioId, setAudioId] = useState<string>("__none__");
  const [imageId, setImageId] = useState<string>("__none__");
  const [textId, setTextId] = useState<string>("__none__");
  const [textBody, setTextBody] = useState<string>("");
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<BatchLeadResult[]>([]);
  const [workLeads, setWorkLeads] = useState<CaptureBatchLead[]>(leads);
  const abortRef = useRef<AbortController | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const aliveRef = useRef(false);
  const runIdRef = useRef(0);

  const audioTemplates = useMemo(
    () => templates.filter((t) => !!templateMediaUrl(t, "audio")),
    [templates],
  );
  const imageTemplates = useMemo(
    () => templates.filter((t) => !!templateMediaUrl(t, "image")),
    [templates],
  );
  const textTemplates = useMemo(
    () => templates.filter((t) => !!templateTextContent(t).trim()),
    [templates],
  );

  // Se o template sumiu da lista, volta para "nenhum".
  useEffect(() => {
    if (audioId !== "__none__" && !audioTemplates.some((t) => t.id === audioId)) {
      setAudioId("__none__");
    }
  }, [audioId, audioTemplates]);
  useEffect(() => {
    if (imageId !== "__none__" && !imageTemplates.some((t) => t.id === imageId)) {
      setImageId("__none__");
    }
  }, [imageId, imageTemplates]);

  const selectedAudio = audioTemplates.find((t) => t.id === audioId);
  const selectedImage = imageTemplates.find((t) => t.id === imageId);
  const audioUrl = templateMediaUrl(selectedAudio, "audio");
  const imageUrl = templateMediaUrl(selectedImage, "image");
  const customText = textBody.trim() ? textBody : null;

  const resultById = useMemo(() => {
    const m = new Map<string, BatchLeadResult>();
    for (const r of results) m.set(r.id, r);
    return m;
  }, [results]);

  const failedLeads = useMemo(() => {
    const failedIds = new Set(results.filter((r) => r.status === "failed").map((r) => r.id));
    return workLeads.filter((l) => failedIds.has(l.id));
  }, [results, workLeads]);

  const done =
    results.length > 0 &&
    !running &&
    results.every((r) => r.status !== "pending" && r.status !== "running");
  const okCount = results.filter((r) => r.status === "ok").length;
  const failCount = results.filter((r) => r.status === "failed").length;
  const showConfig = !done || failCount > 0;

  const needsChannel = !!audioUrl || !!imageUrl || !!customText;
  const canSend =
    (startAttendance || !!audioUrl || !!imageUrl || !!customText) &&
    (!needsChannel || !!instanceName) &&
    workLeads.length > 0;


  useEffect(() => {
    if (open) {
      aliveRef.current = true;
      return;
    }
    aliveRef.current = false;
    abortRef.current?.abort();
    abortRef.current = null;
    runIdRef.current += 1;
    setRunning(false);
    setResults([]);
    try {
      audioRef.current?.pause();
    } catch {
      /* ignore */
    }
  }, [open]);

  // Só reseta formulário ao ABRIR (não a cada nova referência de `leads` durante o envio).
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setWorkLeads(leads);
      setResults([]);
      setStartAttendance(true);
      setAudioId("__none__");
      setImageId("__none__");
      setTextId("__none__");
      setTextBody("");
      setRunning(false);
    }
    wasOpenRef.current = open;
  }, [open, leads]);

  const runFor = async (targets: CaptureBatchLead[]) => {
    if (!targets.length) return;
    if (needsChannel && !instanceName) {
      toast.error("WhatsApp desconectado — reconecte para enviar mensagem");
      return;
    }
    if (!startAttendance && !audioUrl && !imageUrl && !customText) {
      toast.error("Escolha iniciar atendimento, áudio, imagem ou texto");
      return;
    }


    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const runId = ++runIdRef.current;

    // Snapshot de welcome_sent_at atualizado (retry após protocolo parcial).
    const targetsFresh = targets.map((t) => {
      const cur = workLeads.find((w) => w.id === t.id) || t;
      return { ...cur };
    });

    setRunning(true);
    setResults((prev) =>
      mergeResults(
        workLeads.map((l) => l.id),
        prev,
        targetsFresh.map((l) => ({ id: l.id, status: "pending" as const })),
      ),
    );

    try {
      await runAttendanceBatch({
        consultantId,
        instanceName,
        isWhapi,
        leads: targetsFresh.map((l) => ({
          id: l.id,
          name: l.name,
          phone_whatsapp: l.phone_whatsapp,
          welcome_sent_at: l.welcome_sent_at,
        })),
        startAttendance,
        audioUrl,
        imageUrl,
        customText,
        delayMs: 5000,


        signal: ac.signal,
        onProgress: (batchResults) => {
          if (!aliveRef.current || runId !== runIdRef.current) return;
          setResults((prev) => mergeResults(workLeads.map((l) => l.id), prev, batchResults));
          // Marca welcome localmente quando protocolo ok (evita reenvio visual no retry).
          setWorkLeads((prev) =>
            prev.map((l) => {
              const r = batchResults.find((x) => x.id === l.id);
              if (!r || (r.status !== "ok" && r.status !== "skipped")) return l;
              if (r.detail && /protocolo|já iniciado/i.test(r.detail) && !l.welcome_sent_at) {
                return { ...l, welcome_sent_at: new Date().toISOString() };
              }
              return l;
            }),
          );
        },
      });
    } catch (e) {
      if ((e as Error)?.name !== "AbortError" && aliveRef.current && runId === runIdRef.current) {
        toast.error((e as Error)?.message || "Falha no lote");
      }
    } finally {
      if (aliveRef.current && runId === runIdRef.current) {
        setRunning(false);
        onFinished?.();
      }
    }
  };

  const stop = () => {
    abortRef.current?.abort();
  };

  const handleOpenChange = (o: boolean) => {
    if (running && !o) return;
    onOpenChange(o);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        hideCloseButton={running}
        className="max-w-lg max-h-[90dvh] flex flex-col gap-0 p-0 overflow-hidden"

        onPointerDownOutside={(e) => {
          if (running) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (running) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (running) e.preventDefault();
        }}
      >
        <DialogHeader className="px-5 pt-5 pb-3 shrink-0 space-y-1">
          <DialogTitle>Abrir atendimento</DialogTitle>
          <DialogDescription>
            {workLeads.length} cliente{workLeads.length === 1 ? "" : "s"} · {periodLabel}
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 flex-1 min-h-0 overflow-y-auto space-y-4 pb-2">
          <ul className={`rounded-lg border border-border divide-y divide-border/60 overflow-y-auto ${workLeads.length <= 3 ? "max-h-32" : "max-h-44"}`}>
            {workLeads.map((l) => (
              <li key={l.id} className="flex items-center gap-2.5 px-2.5 py-2">
                <div
                  className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold ${toneFor(l.id)}`}
                >
                  {initialsFrom(l.name, l.phone_whatsapp)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate sensitive-name">{l.name || "Sem nome"}</p>
                  {resultById.get(l.id)?.detail && resultById.get(l.id)?.status !== "running" && (
                    <p className="text-[10px] text-muted-foreground truncate">{resultById.get(l.id)?.detail}</p>
                  )}
                </div>
                {leadPill(l, resultById.get(l.id))}
              </li>
            ))}
          </ul>


          {showConfig && (
            <>
              {/* 1) MENSAGEM DE TEXTO — protagonista, sempre visível e editável */}
              <div className="space-y-2 scroll-mt-2">
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <MessageSquare className="w-3.5 h-3.5 text-primary" />
                    Mensagem para enviar
                  </Label>
                  <span className="text-[10px] text-muted-foreground">template ou escreva</span>
                </div>
                <Select
                  value={textId}
                  onValueChange={(v) => {
                    setTextId(v);
                    if (v === "__none__") setTextBody("");
                    else if (v === "__blank__") setTextBody("");
                    else {
                      const t = textTemplates.find((x) => x.id === v);
                      setTextBody(templateTextContent(t) || "");
                    }
                  }}
                  disabled={running}
                >
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="Escolher template ou escrever nova…" />
                  </SelectTrigger>
                  <SelectContent className="z-[130]">
                    <SelectItem value="__none__">Nenhuma mensagem</SelectItem>
                    <SelectItem value="__blank__">Escrever nova mensagem…</SelectItem>
                    {textTemplates.map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Textarea
                  value={textBody}
                  onChange={(e) => {
                    setTextBody(e.target.value);
                    if (e.target.value.trim() && textId === "__none__") setTextId("__blank__");
                  }}
                  placeholder="Escreva a mensagem que vai pra todos… use {{nome}} para personalizar."
                  rows={4}
                  disabled={running}
                  className="text-xs rounded-lg resize-y min-h-[96px] max-h-[200px]"
                />
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    disabled={running}
                    onClick={() => setTextBody((v) => (v ? `${v} {{nome}}` : "{{nome}}"))}
                    className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20"
                  >
                    inserir {"{{nome}}"}
                  </button>
                  {textBody.trim() && workLeads[0] && (
                    <span className="text-[10px] text-muted-foreground truncate max-w-[60%]" title={`Para ${workLeads[0].name || "cliente"}: ${textBody.split("{{nome}}").join((workLeads[0].name || "").split(/\s+/)[0] || "tudo bem")}`}>
                      Prévia: {(textBody.split("{{nome}}").join((workLeads[0].name || "").split(/\s+/)[0] || "tudo bem")).slice(0, 40)}…
                    </span>
                  )}
                </div>
              </div>


              {/* 2) ÁUDIO */}
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Áudio (opcional)</Label>
                <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2.5">
                  <div className="shrink-0 w-9 h-9 rounded-full bg-primary flex items-center justify-center">
                    <Mic className="w-4 h-4 text-primary-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <Select value={audioId} onValueChange={setAudioId} disabled={running}>
                      <SelectTrigger className="h-8 text-xs border-0 shadow-none px-0 focus:ring-0">
                        <SelectValue placeholder="Nenhum áudio" />
                      </SelectTrigger>
                      <SelectContent className="z-[130]">
                        <SelectItem value="__none__">Nenhum áudio</SelectItem>
                        {audioTemplates.map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {audioUrl && (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 shrink-0"
                      disabled={running}
                      onClick={() => {
                        try {
                          if (!audioRef.current) audioRef.current = new Audio(audioUrl);
                          else audioRef.current.src = audioUrl;
                          void audioRef.current.play().catch(() => {
                            toast.error("Não foi possível reproduzir");
                          });
                        } catch {
                          toast.error("Não foi possível reproduzir");
                        }
                      }}
                      title="Ouvir"
                    >
                      <Play className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
                {audioTemplates.length === 0 && (
                  <p className="text-[10px] text-muted-foreground">
                    Salve um áudio como template no WhatsApp para usar aqui.
                  </p>
                )}
              </div>

              {/* 3) IMAGEM */}
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Imagem (opcional)</Label>
                <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2.5">
                  <div className="shrink-0 w-9 h-9 rounded-full bg-muted flex items-center justify-center">
                    <ImageIcon className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <Select value={imageId} onValueChange={setImageId} disabled={running}>
                      <SelectTrigger className="h-8 text-xs border-0 shadow-none px-0 focus:ring-0">
                        <SelectValue placeholder="Nenhuma imagem" />
                      </SelectTrigger>
                      <SelectContent className="z-[130]">
                        <SelectItem value="__none__">Nenhuma imagem</SelectItem>
                        {imageTemplates.map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {imageUrl && (
                  <img
                    src={imageUrl}
                    alt="Prévia"
                    className="max-h-24 rounded-md border border-border object-contain bg-muted/30"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = "none";
                    }}
                  />
                )}
              </div>

              {/* 4) Protocolo interno — secundário */}
              <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-border px-3 py-2.5 bg-muted/20">
                <div className="min-w-0">
                  <Label htmlFor="batch-start-att" className="text-xs font-medium">
                    Registrar protocolo interno
                  </Label>
                  <p className="text-[10px] text-muted-foreground">
                    {customText
                      ? "Desligado — sua mensagem substitui a frase padrão."
                      : "Envia frase padrão de abertura (pula quem já iniciou)."}
                  </p>
                </div>
                <Switch
                  id="batch-start-att"
                  checked={startAttendance && !customText}
                  onCheckedChange={setStartAttendance}
                  disabled={running || !!customText}
                />
              </div>

              {needsChannel && !instanceName && (
                <p className="text-[11px] text-destructive">
                  WhatsApp desconectado — reconecte para enviar áudio/imagem.
                </p>
              )}

              <p className="text-[11px] text-muted-foreground">
                Envio com intervalo de 5s entre cada cliente.
              </p>
            </>
          )}

          {done && (
            <p className="text-sm text-muted-foreground">
              Concluído: <span className="font-semibold text-foreground">{okCount}</span> ok
              {failCount > 0 && (
                <>
                  {" "}
                  · <span className="font-semibold text-destructive">{failCount}</span> falha
                  {failCount === 1 ? "" : "s"}
                </>
              )}
            </p>
          )}
        </div>

        <DialogFooter className="px-5 py-4 border-t border-border shrink-0 gap-2 sm:gap-2">
          {running ? (
            <Button type="button" variant="outline" onClick={stop} className="gap-1.5">
              <Square className="w-3.5 h-3.5" /> Parar
            </Button>
          ) : (
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {done ? "Fechar" : "Cancelar"}
            </Button>
          )}

          {!done && !running && (
            <Button
              type="button"
              disabled={!canSend}
              onClick={() => void runFor(workLeads)}
            >
              Enviar para {workLeads.length}
            </Button>
          )}

          {running && (
            <Button type="button" disabled className="gap-1.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Enviando…
            </Button>
          )}

          {done && failedLeads.length > 0 && !running && (
            <Button
              type="button"
              variant="default"
              className="gap-1.5"
              disabled={!canSend}
              onClick={() => void runFor(failedLeads)}
            >
              <RotateCcw className="w-3.5 h-3.5" /> Tentar de novo ({failedLeads.length})
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
