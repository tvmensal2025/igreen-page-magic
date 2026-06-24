import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { History, Loader2, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { listCustomerSolarAnalyses, loadSolarSnapshot } from "../lib/api";
import type { SolarAnalyzeResult } from "../lib/types";

interface SavedRow {
  analysisId: string;
  snapshotId: string;
  addressText: string | null;
  imageryQuality: string;
  panelsCount: number;
  systemKwp: number;
  createdAt: string;
}

export function SolarSavedAnalysesList({
  customerId,
  onSelect,
}: {
  customerId: string;
  onSelect: (result: SolarAnalyzeResult) => void;
}) {
  const [rows, setRows] = useState<SavedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listCustomerSolarAnalyses(customerId)
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando análises salvas…
      </div>
    );
  }

  if (!rows.length) return null;

  const openSaved = async (snapshotId: string) => {
    setLoadingId(snapshotId);
    try {
      const result = await loadSolarSnapshot(snapshotId);
      onSelect(result);
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <History className="h-4 w-4 text-primary" />
        Análises já salvas neste cliente
      </div>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li
            key={r.snapshotId}
            className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-lg border bg-card p-3"
          >
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm font-medium truncate flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                {r.addressText ?? "Endereço não informado"}
              </p>
              <p className="text-xs text-muted-foreground">
                {r.systemKwp} kWp · {r.panelsCount} módulos ·{" "}
                {formatDistanceToNow(new Date(r.createdAt), { addSuffix: true, locale: ptBR })}
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="shrink-0"
              disabled={loadingId === r.snapshotId}
              onClick={() => openSaved(r.snapshotId)}
            >
              {loadingId === r.snapshotId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Abrir"}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
