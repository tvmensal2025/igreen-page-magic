/**
 * Cortes TTS Sofia — painel compacto (aba Mídia).
 */
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle } from "lucide-react";
import { WhatsAppFormattedText } from "@/lib/whatsapp/formatWhatsAppText";
import type { AudioSegment } from "@/lib/multichannelCadenceTexts";
import { spokenSegmentText } from "@/lib/multichannelCadenceTexts";

type Props = {
  segments: AudioSegment[];
  previewName: string;
  previewVars: Parameters<typeof spokenSegmentText>[1];
  isSegmentOk: (segId: string) => boolean;
  segmentsReady: boolean;
  hint?: ReactNode;
  onApproveAll: () => void;
  onToggleApproved: (segId: string, on: boolean) => void;
  onSetText: (segId: string, text: string) => void;
  onInsertNome: (segId: string, current: string) => void;
  readOnly?: boolean;
};

export function CadenceAudioCutsPanel({
  segments,
  previewName,
  previewVars,
  isSegmentOk,
  segmentsReady,
  hint,
  onApproveAll,
  onToggleApproved,
  onSetText,
  onInsertNome,
  readOnly = false,
}: Props) {
  if (segments.length === 0) return null;
  const firstNome = previewName.split(/\s+/)[0] || "Nome";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <Label className="text-xs font-semibold">Cortes Sofia</Label>
          {hint && (
            <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{hint}</p>
          )}
        </div>
        {!readOnly && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 shrink-0 text-[11px]"
            onClick={onApproveAll}
          >
            Aprovar todos
          </Button>
        )}
      </div>

      {segments.map((seg) => {
        const ok = isSegmentOk(seg.id);
        const spoken = spokenSegmentText(seg, previewVars);
        const nameLead = /^então\b/i.test(spoken)
          ? "Então"
          : /^olá\b/i.test(spoken)
            ? "Olá"
            : null;
        const kindLabel =
          seg.kind === "name"
            ? nameLead
              ? `${nameLead}+nome`
              : "Nome"
            : seg.kind === "gendered"
              ? "M/F"
              : seg.kind === "with_name"
                ? "Com nome"
                : "Fixo";
        const lockedName = seg.kind === "name";

        return (
          <div
            key={seg.id}
            className="space-y-1.5 rounded-lg border border-border/60 bg-card/60 p-2.5"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-xs font-medium">{seg.label}</span>
                <Badge variant="secondary" className="h-4 px-1.5 text-[9px] font-normal">
                  {kindLabel}
                </Badge>
              </div>
              {!readOnly && (
                <div className="flex items-center gap-1.5">
                  <Label className="text-[10px] text-muted-foreground">Ok</Label>
                  <Switch
                    checked={ok}
                    onCheckedChange={(v) => onToggleApproved(seg.id, v)}
                    className="scale-90"
                  />
                </div>
              )}
            </div>

            {lockedName ? (
              <p className="rounded-md bg-muted/40 px-2 py-1.5 text-[11px] leading-snug">
                {spoken}
                <span className="mt-0.5 block text-[10px] text-muted-foreground">
                  Cache por nome · ex. {firstNome}
                </span>
              </p>
            ) : readOnly ? (
              <div className="max-h-20 overflow-y-auto rounded-md bg-muted/30 px-2 py-1.5">
                <WhatsAppFormattedText
                  text={spoken}
                  className="whitespace-pre-wrap break-words text-[11px] leading-snug text-muted-foreground"
                />
              </div>
            ) : (
              <div className="space-y-1">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 px-1.5 font-mono text-[10px] text-muted-foreground"
                  onClick={() => onInsertNome(seg.id, seg.text)}
                >
                  {"{{nome}}"}
                </Button>
                <Textarea
                  id={`seg-ta-${seg.id}`}
                  value={seg.text}
                  onChange={(e) => onSetText(seg.id, e.target.value)}
                  rows={seg.kind === "gendered" || seg.kind === "with_name" ? 2 : 3}
                  className="min-h-0 resize-y text-[12px] leading-snug"
                />
              </div>
            )}
          </div>
        );
      })}

      {!readOnly && !segmentsReady && (
        <div className="flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>Aprove os cortes antes de gerar.</span>
        </div>
      )}
    </div>
  );
}
