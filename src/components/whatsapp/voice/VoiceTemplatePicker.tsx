import { useState, useCallback } from "react";
import { Mic2, Send, Loader2, Play, AlertTriangle, ChevronRight, Variable, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useVoiceTemplates } from "@/hooks/useVoiceTemplates";
import { VoiceClipRecorder } from "./VoiceClipRecorder";

interface Props {
  consultantId: string;
  /** Nome do lead atual (pré-preenche o campo de nome). */
  customerName?: string;
  /** Chamado com a URL do áudio costurado pronto pra enviar. */
  onSendAudioUrl: (url: string) => Promise<void>;
  disabled?: boolean;
}

/**
 * Botão 🎙 no MessageComposer que lista os voice templates do consultor,
 * costura o áudio com o nome do lead e envia direto pelo chat.
 *
 * Fluxo:
 * 1. Abre popover com lista de templates
 * 2. Consultor seleciona um template
 * 3. Preenche nome do lead (pré-preenchido com customerName) e variáveis
 * 4. Clica em "Enviar" → chama voice-template-stitch → onSendAudioUrl
 * 5. Se nome não gravado → mostra gravador inline
 */
export function VoiceTemplatePicker({ consultantId, customerName, onSendAudioUrl, disabled }: Props) {
  const vt = useVoiceTemplates(consultantId);
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState(customerName || "");
  const [varInputs, setVarInputs] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [pendingRecord, setPendingRecord] = useState<{ name: string; key: string } | null>(null);

  const selected = vt.templates.find((t) => t.id === selectedId) || null;
  const hasNameSlot = selected?.blocks?.some((b) => b.kind === "name_slot") ?? false;
  const variableBlocks = selected?.blocks?.filter((b) => b.kind === "variable_slot") ?? [];

  // Quando abre o popover, pré-preenche o nome com o do lead
  const handleOpen = useCallback((v: boolean) => {
    if (v) {
      setNameInput(customerName || "");
      setSelectedId(null);
      setVarInputs({});
      setPendingRecord(null);
    }
    setOpen(v);
  }, [customerName]);

  const handleSelectTemplate = useCallback((id: string) => {
    setSelectedId(id);
    setVarInputs({});
    setPendingRecord(null);
  }, []);

  const handleSend = useCallback(async () => {
    if (!selected) return;

    // Valida variáveis obrigatórias
    for (const b of variableBlocks) {
      const k = b.variable_key || "";
      if (!varInputs[k]?.trim()) {
        toast.error(`Preencha o valor de {{${k}}}`);
        return;
      }
    }

    setSending(true);
    setPendingRecord(null);
    try {
      const res = await vt.renderTemplate(
        selected.id,
        hasNameSlot ? nameInput.trim() : undefined,
        variableBlocks.length > 0 ? varInputs : undefined,
      );

      if (res.url) {
        await onSendAudioUrl(res.url);
        toast.success("Áudio de voz enviado");
        setOpen(false);
        setSelectedId(null);
      } else if (res.error === "name_not_recorded") {
        setPendingRecord({
          name: res.missing_name || nameInput,
          key: res.missing_key || "nome",
        });
        toast.warning(`Grave "${res.missing_name}" primeiro`);
      } else {
        toast.error(res.error || "Falha ao costurar áudio");
      }
    } finally {
      setSending(false);
    }
  }, [selected, hasNameSlot, nameInput, variableBlocks, varInputs, vt, onSendAudioUrl]);

  if (!vt.templates.length && !vt.loading) return null;

  return (
    <Popover open={open} onOpenChange={handleOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 text-primary hover:text-primary hover:bg-primary/10"
          disabled={disabled}
          title="Enviar template de voz personalizado"
        >
          <Mic2 className="h-4 w-4" />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        side="top"
        align="start"
        className="w-80 p-0 overflow-hidden"
        sideOffset={8}
      >
        <div className="p-3 border-b border-border bg-gradient-to-r from-primary/10 to-transparent">
          <div className="flex items-center gap-2">
            <Mic2 className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold text-foreground">Templates de Voz</span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Selecione um template para enviar com o nome do cliente interessado
          </p>
        </div>

        {vt.loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : !selected ? (
          /* Lista de templates */
          <div className="max-h-64 overflow-y-auto">
            {vt.templates.map((t) => {
              const hasName = t.blocks?.some((b) => b.kind === "name_slot");
              const varCount = t.blocks?.filter((b) => b.kind === "variable_slot").length || 0;
              const blockCount = t.blocks?.length || 0;
              const hasAllAudio = t.blocks?.every((b) => b.kind !== "fixed_audio" || b.audio_url);
              return (
                <button
                  key={t.id}
                  onClick={() => handleSelectTemplate(t.id)}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-accent/40 border-b border-border/50 last:border-0"
                >
                  <Mic2 className="w-4 h-4 text-primary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate text-foreground">{t.name}</p>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      <span className="text-[10px] text-muted-foreground">{blockCount} bloco{blockCount !== 1 ? "s" : ""}</span>
                      {hasName && <Badge variant="outline" className="text-[9px] h-4 px-1 text-primary border-primary/30"><User className="w-2.5 h-2.5 mr-0.5" />nome</Badge>}
                      {varCount > 0 && <Badge variant="outline" className="text-[9px] h-4 px-1 text-primary border-primary/30"><Variable className="w-2.5 h-2.5 mr-0.5" />{varCount} var</Badge>}
                      {!hasAllAudio && <Badge variant="outline" className="text-[9px] h-4 px-1 text-warning border-warning/30"><AlertTriangle className="w-2.5 h-2.5 mr-0.5" />incompleto</Badge>}
                      {t.shortcut && <span className="text-[10px] font-mono text-primary">{t.shortcut}</span>}
                    </div>
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                </button>
              );
            })}
          </div>
        ) : (
          /* Formulário de envio */
          <div className="p-3 space-y-3">
            <button
              onClick={() => { setSelectedId(null); setPendingRecord(null); }}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <ChevronRight className="w-3 h-3 rotate-180" />
              Voltar
            </button>

            <div className="flex items-center gap-2">
              <Mic2 className="w-4 h-4 text-primary shrink-0" />
              <span className="text-sm font-semibold text-foreground truncate">{selected.name}</span>
            </div>

            {/* Campo de nome do lead */}
            {hasNameSlot && (
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <User className="w-3 h-3" /> Nome do cliente interessado
                </label>
                <Input
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  placeholder="Ex: Ana"
                  className="h-8 text-sm"
                  autoFocus
                />
              </div>
            )}

            {/* Campos de variáveis */}
            {variableBlocks.map((b) => {
              const k = b.variable_key || "";
              return (
                <div key={b.id} className="space-y-1">
                  <label className="text-[11px] text-muted-foreground flex items-center gap-1">
                    <Variable className="w-3 h-3" /> {`{{${k}}}`}
                  </label>
                  <Input
                    value={varInputs[k] || ""}
                    onChange={(e) => setVarInputs((v) => ({ ...v, [k]: e.target.value }))}
                    placeholder={`Valor de {{${k}}}`}
                    className="h-8 text-sm"
                  />
                </div>
              );
            })}

            {/* Gravador inline quando nome não está na biblioteca */}
            {pendingRecord && (
              <div className="rounded border border-warning/40 bg-warning/5 p-2 space-y-1.5">
                <p className="text-[11px] text-warning flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  Grave <strong>"{pendingRecord.name}"</strong>
                  {pendingRecord.key !== "nome" && <> para <code>{`{{${pendingRecord.key}}}`}</code></>}:
                </p>
                <VoiceClipRecorder
                  consultantId={consultantId}
                  slug={`voz-${pendingRecord.key}-${pendingRecord.name.toLowerCase().replace(/\s+/g, "-")}`}
                  idleLabel={`Gravar "${pendingRecord.name}"`}
                  onUploaded={async (url) => {
                    await vt.upsertNameClip(pendingRecord.name, url);
                    setPendingRecord(null);
                    toast.success(`"${pendingRecord.name}" gravado. Clique em Enviar de novo.`);
                  }}
                />
              </div>
            )}

            {/* Preview de áudio se já renderizou antes */}
            <div className="flex gap-2">
              <Button
                size="sm"
                className="flex-1 gap-1.5 bg-primary hover:bg-primary text-white"
                onClick={handleSend}
                disabled={sending || (hasNameSlot && !nameInput.trim())}
              >
                {sending
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Costurando…</>
                  : <><Send className="w-3.5 h-3.5" /> Enviar áudio</>}
              </Button>
            </div>

            <p className="text-[10px] text-muted-foreground">
              O áudio será costurado na hora e enviado como mensagem de voz.
            </p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
