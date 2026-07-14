/**
 * Notas de atendimento (1–5) dadas pelos clientes ao finalizar.
 * Mostra nome (se houver) ou telefone, nota, dia e horário.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Star, RefreshCw, Loader2, MessageSquareHeart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

type RatingRow = {
  id: string;
  name: string | null;
  phone_whatsapp: string | null;
  attendance_rating: number;
  attendance_rating_at: string | null;
};

function fmtPhone(raw: string | null): string {
  if (!raw) return "—";
  if (/sem_celular/i.test(raw)) return "Sem telefone";
  const d = raw.replace(/\D/g, "");
  const local = d.startsWith("55") && d.length >= 12 ? d.slice(2) : d;
  if (local.length < 10) return raw;
  return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
}

function Stars({ n }: { n: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${n} de 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={cn(
            "h-3.5 w-3.5",
            i <= n ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30",
          )}
        />
      ))}
    </span>
  );
}

export function AttendanceRatingsCard({
  consultantId,
  className,
}: {
  consultantId: string;
  className?: string;
}) {
  const [rows, setRows] = useState<RatingRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("customers")
      .select("id, name, phone_whatsapp, attendance_rating, attendance_rating_at")
      .eq("consultant_id", consultantId)
      .not("attendance_rating", "is", null)
      .order("attendance_rating_at", { ascending: false, nullsFirst: false })
      .limit(40);
    if (error) {
      console.error("[AttendanceRatingsCard]", error);
      setRows([]);
    } else {
      setRows(
        ((data || []) as RatingRow[]).filter(
          (r) => r.attendance_rating != null && r.attendance_rating >= 1 && r.attendance_rating <= 5,
        ),
      );
    }
    setLoading(false);
  }, [consultantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const avg =
    rows.length > 0
      ? Math.round((rows.reduce((s, r) => s + Number(r.attendance_rating), 0) / rows.length) * 10) / 10
      : null;

  return (
    <div className={cn("bg-card border border-border min-w-0 rounded-xl p-3 space-y-3", className)}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-amber-500/15 flex items-center justify-center shrink-0">
            <MessageSquareHeart className="w-4 h-4 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="min-w-0">
            <h3 className="font-heading font-bold text-foreground text-sm">Notas dos clientes</h3>
            <p className="text-[11px] text-muted-foreground">
              Avaliação 1–5 após finalizar o atendimento
              {avg != null ? ` · média ${avg}` : ""}
            </p>
          </div>
        </div>
        <Button type="button" size="sm" variant="ghost" className="h-7 gap-1" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Atualizar
        </Button>
      </div>

      {loading && rows.length === 0 ? (
        <div className="flex items-center justify-center py-8 text-muted-foreground gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          Nenhuma nota ainda. Elas aparecem quando o cliente responde à pesquisa ao finalizar o atendimento.
        </p>
      ) : (
        <ul className="divide-y divide-border/60 max-h-[280px] overflow-y-auto">
          {rows.map((r) => {
            const name = (r.name || "").trim();
            const label = name || fmtPhone(r.phone_whatsapp);
            const when = r.attendance_rating_at
              ? format(new Date(r.attendance_rating_at), "dd MMM yyyy · HH:mm", { locale: ptBR })
              : "—";
            return (
              <li key={r.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                <div
                  className={cn(
                    "shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold tabular-nums",
                    r.attendance_rating >= 4
                      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                      : r.attendance_rating === 3
                        ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                        : "bg-destructive/15 text-destructive",
                  )}
                >
                  {r.attendance_rating}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-foreground truncate">{label}</span>
                    <Stars n={r.attendance_rating} />
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
                    <span>{when}</span>
                    {name && r.phone_whatsapp && (
                      <>
                        <span>·</span>
                        <span className="truncate">{fmtPhone(r.phone_whatsapp)}</span>
                      </>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
