import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Check, AlertTriangle, X, Sparkles } from "lucide-react";
import { aggregate, scoreCopy, scoreImage, scoreVideo, type QualityResult } from "@/lib/adQualityScore";

interface Props {
  headline: string; primary: string; description: string;
  cityCount: number; distribuidora?: string | null;
  primaryImage?: { url: string; w: number; h: number; format: "square" | "vertical" | "story" } | null;
  primaryVideo?: { w: number; h: number; duration: number } | null;
  onChange?: (r: QualityResult) => void;
}

export function AdQualityPanel({ headline, primary, description, cityCount, distribuidora, primaryImage, primaryVideo, onChange }: Props) {
  const [result, setResult] = useState<QualityResult | null>(null);
  const isVideo = !!primaryVideo;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const copy = scoreCopy({ headline, primary, description, cityCount, distribuidora });
      const media = primaryVideo
        ? scoreVideo({ width: primaryVideo.w, height: primaryVideo.h, duration: primaryVideo.duration })
        : primaryImage
          ? await scoreImage({ width: primaryImage.w, height: primaryImage.h, dataUrl: primaryImage.url, format: primaryImage.format })
          : { score: 0, checks: [{ ok: false, label: "Nenhuma mídia enviada" }] };
      if (cancelled) return;
      const r = aggregate(copy, media);
      setResult(r);
      onChange?.(r);
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headline, primary, description, cityCount, distribuidora, primaryImage?.url, primaryVideo?.w, primaryVideo?.h, primaryVideo?.duration]);

  if (!result) return null;
  const colorBg = result.level === "green" ? "bg-emerald-500/10 border-emerald-500/30" : result.level === "yellow" ? "bg-amber-500/10 border-amber-500/30" : "bg-destructive/10 border-destructive/30";
  const colorText = result.level === "green" ? "text-emerald-400" : result.level === "yellow" ? "text-amber-400" : "text-destructive";

  return (
    <Card className={`p-3 space-y-2 border ${colorBg}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          <Sparkles className="w-3.5 h-3.5" /> Score do anúncio
        </div>
        <div className={`text-2xl font-black ${colorText}`}>{result.score}<span className="text-xs text-muted-foreground">/100</span></div>
      </div>
      <div className={`text-xs font-semibold ${colorText}`}>{result.summary}</div>

      <div className="space-y-2 pt-1">
        <Section title="Copy" score={result.copy.score} checks={result.copy.checks} />
        <Section title={isVideo ? "Vídeo" : "Imagem"} score={result.image.score} checks={result.image.checks} />
        {!isVideo && result.image.score < 70 && (
          <div className="text-[10px] text-muted-foreground italic pl-1">
            Dica: fotos reais com bastante detalhe podem ser sinalizadas como "muito texto". Você ainda pode publicar.
          </div>
        )}
      </div>

      {result.copy.hits.length > 0 && (
        <div className="border-t border-border/40 pt-2 space-y-1">
          {result.copy.hits.map((h, i) => (
            <div key={i} className={`text-[11px] flex items-start gap-1.5 ${h.severity === "block" ? "text-destructive" : "text-amber-400"}`}>
              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
              <span>{h.message}{h.suggestion && <span className="text-muted-foreground"> — {h.suggestion}</span>}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function Section({ title, score, checks }: { title: string; score: number; checks: { ok: boolean; label: string; detail?: string }[] }) {
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] font-semibold text-muted-foreground">
        <span>{title}</span><span>{score}/100</span>
      </div>
      <ul className="space-y-0.5 mt-1">
        {checks.map((c, i) => (
          <li key={i} className="text-[11px] flex items-start gap-1.5">
            {c.ok ? <Check className="w-3 h-3 text-emerald-400 mt-0.5 shrink-0" /> : <X className="w-3 h-3 text-destructive mt-0.5 shrink-0" />}
            <span className={c.ok ? "text-foreground/80" : "text-muted-foreground"}>
              {c.label}{c.detail && <span className="text-muted-foreground/70"> · {c.detail}</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}