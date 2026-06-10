import { useEffect, useState, useRef } from "react";
import { CAPTURE_FIELDS, CaptureFieldKey, useCaptureSession } from "@/hooks/useCaptureSession";
import { useCaptureSuggestions } from "@/hooks/useCaptureSuggestions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Check, Edit2, Loader2, X, Bot } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { CaptureDocumentTiles } from "./CaptureDocumentTiles";
import { CaptureDataConfirmCard } from "./CaptureDataConfirmCard";
import { bumpMission } from "./CaptureMissionsPanel";
import { ProgressRing } from "./ProgressRing";

interface Props {
  customerId: string;
  onSubmitted?: () => void;
  embedded?: boolean;
  sentStepsCount?: number;
  /** Botão de ação no rodapé da ficha (ex.: Finalizar cadastro). */
  footer?: React.ReactNode;
}

export function CaptureLeadCard({ customerId, onSubmitted, embedded = false, sentStepsCount = 0, footer }: Props) {
  const { customer, loading, filledCount, totalFields, progress, updateField, validation } = useCaptureSession(customerId);
  const { suggestions, resolve } = useCaptureSuggestions(customerId);
  const { toast } = useToast();
  const [editing, setEditing] = useState<CaptureFieldKey | null>(null);
  const [editValue, setEditValue] = useState("");
  const [flashKey, setFlashKey] = useState<string | null>(null);
  const lastCountRef = useRef<number>(0);

  const suggestionByField = new Map(suggestions.map((s) => [s.field_name, s]));

  const acceptSuggestion = async (key: CaptureFieldKey) => {
    const s = suggestionByField.get(key);
    if (!s) return;
    try {
      let value: any = s.suggested_value;
      if (key === "electricity_bill_value") value = Number(String(value).replace(",", ".")) || null;
      await updateField(key, value);
      await resolve(s.id, "accepted");
      if (customer?.consultant_id) bumpMission(customer.consultant_id, "aiAccepts");
      toast({ title: `Dado capturado da conversa`, duration: 1500 });
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message || String(e), variant: "destructive" });
    }
  };

  // Flash discreto no campo recém-preenchido (sem som)
  useEffect(() => {
    if (loading || !customer) { lastCountRef.current = filledCount; return; }
    const prev = lastCountRef.current;
    if (filledCount > prev && prev >= 0) {
      const last = [...CAPTURE_FIELDS].reverse().find((f) => {
        const v = (customer as any)[f.key];
        return v !== null && v !== undefined && String(v).trim() !== "";
      });
      if (last) {
        setFlashKey(last.key);
        setTimeout(() => setFlashKey(null), 700);
      }
    }
    lastCountRef.current = filledCount;
  }, [filledCount, totalFields, loading, customer]); // eslint-disable-line

  const startEdit = (key: CaptureFieldKey) => {
    setEditing(key);
    const v = customer ? (customer as any)[key] : "";
    setEditValue(v ?? "");
  };

  const saveEdit = async () => {
    if (!editing) return;
    try {
      let value: any = editValue;
      if (editing === "electricity_bill_value") value = Number(String(editValue).replace(",", ".")) || null;
      if (typeof value === "string") value = value.trim() || null;
      await updateField(editing, value);
      setEditing(null);
    } catch (e: any) {
      toast({ title: "Erro ao salvar", description: e?.message || String(e), variant: "destructive" });
    }
  };

  if (loading || !customer) {
    return <div className="p-6 text-center text-sm text-muted-foreground"><Loader2 className="w-5 h-5 mx-auto animate-spin" /></div>;
  }

  const canSubmit = !!validation?.ok;
  const firstPending = validation?.pendingItems?.[0];

  return (
    <aside className={embedded
      ? "w-full h-full flex flex-col bg-transparent overflow-hidden"
      : "w-full h-full min-w-0 shrink-0 flex flex-col bg-card/40 overflow-hidden"}>

      {/* Cabeçalho com anel de progresso (substitui o HUD de jogo) */}
      <div className="flex items-center gap-3 px-3 py-2.5 border-b border-border/60 shrink-0">
        <ProgressRing progress={progress} filled={filledCount} total={totalFields} size={48} />
        <div className="min-w-0">
          <p className="text-xs font-semibold text-foreground">
            {canSubmit ? "Tudo pronto" : `${filledCount} de ${totalFields} preenchidos`}
          </p>
          <p className="text-[11px] text-muted-foreground truncate">
            {canSubmit ? "Pode cadastrar" : firstPending ? `Falta: ${firstPending.label}` : "Continue preenchendo"}
          </p>
        </div>
      </div>

      {/* Campos + documentos */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="overflow-y-auto p-2 space-y-1.5">
          <CaptureDataConfirmCard kind="bill" customer={customer} />
          <CaptureDataConfirmCard kind="doc" customer={customer} />
          <div className="flex flex-col gap-1">
          {CAPTURE_FIELDS.filter((f) => f.key !== "document_front_url").map(f => {
            const v = (customer as any)[f.key];
            const filled = v !== null && v !== undefined && String(v).trim() !== "" && (f.key !== "electricity_bill_value" || Number(v) > 0);
            const isEditingThis = editing === f.key;
            const sugg = suggestionByField.get(f.key);
            const isFlashing = flashKey === f.key;

            return (
              <div
                key={f.key}
                onClick={() => { if (!isEditingThis) startEdit(f.key); }}
                className={`group cursor-text rounded-md border transition-all px-2 py-1.5 ${
                  isFlashing ? "border-primary bg-primary/10" :
                  sugg ? "border-warning/60 bg-warning/5 ring-1 ring-warning/30" :
                  filled ? "border-primary/25 bg-primary/[0.04] hover:border-primary/40" : "border-border/60 bg-background/40 hover:border-primary/30 hover:bg-background"
                }`}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  {filled ? (
                    <Check className="w-3 h-3 text-primary shrink-0" />
                  ) : (
                    <div className="w-2 h-2 rounded-full border border-muted-foreground/40 shrink-0" />
                  )}
                  <span className="font-semibold uppercase tracking-wide text-muted-foreground/80 shrink-0 text-[9px] w-[72px]">{f.label}</span>
                  {!isEditingThis && (
                    <p
                      className={`flex-1 min-w-0 truncate text-[11px] leading-tight ${filled ? "text-foreground font-medium" : "text-muted-foreground/40 italic"}`}
                      title={filled ? String(v) : undefined}
                    >
                      {filled ? String(v) : "toque para preencher"}
                    </p>
                  )}
                  {!isEditingThis && filled && (
                    <Edit2 className="w-3 h-3 text-muted-foreground/40 group-hover:text-primary shrink-0 transition" />
                  )}
                </div>
                {isEditingThis && (
                  <div className="mt-1 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <Input
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") void saveEdit(); if (e.key === "Escape") setEditing(null); }}
                      autoFocus
                      className="h-7 text-xs"
                    />
                    <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => void saveEdit()}><Check className="w-3.5 h-3.5" /></Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => setEditing(null)}><X className="w-3.5 h-3.5" /></Button>
                  </div>
                )}
                {sugg && !isEditingThis && (
                  <div className="mt-1 flex items-center gap-1 rounded bg-warning/10 border border-warning/40 px-1 py-0.5" onClick={(e) => e.stopPropagation()}>
                    <Bot className="w-3 h-3 text-warning shrink-0" />
                    <span className="text-[10px] flex-1 truncate text-warning dark:text-warning">
                      IA: <strong>{sugg.suggested_value}</strong>
                    </span>
                    <Button size="icon" variant="ghost" className="h-5 w-5 text-primary hover:text-primary" onClick={() => void acceptSuggestion(f.key)} title="Aceitar">
                      <Check className="w-3 h-3" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => { setEditing(f.key); setEditValue(sugg.suggested_value); void resolve(sugg.id, "edited"); }} title="Editar">
                      <Edit2 className="w-3 h-3" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-5 w-5 text-muted-foreground" onClick={() => void resolve(sugg.id, "dismissed")} title="Descartar">
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
          </div>
          {/* Documentos */}
          <div className="border-t border-border/60 pt-1.5">
            <CaptureDocumentTiles
              customerId={customerId}
              customer={customer}
              onUploaded={async (key, url) => { await updateField(key as any, url); }}
              compact
            />
          </div>
        </div>
      </div>

      {/* Rodapé: botão de finalizar (acende quando completo) + resumo do que falta */}
      <div className="border-t border-border shrink-0">
        {footer}
      </div>
    </aside>
  );
}
