import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2, AlertTriangle, Loader2, ChevronDown, ChevronUp, FlaskConical } from "lucide-react";

interface Props {
  customerId: string;
  defaultCollapsed?: boolean;
}

interface ClubRow {
  club_status: string | null;
  club_error: string | null;
  club_error_kind: string | null;
  club_dry_run: boolean | null;
  club_created_at: string | null;
  club_updated_at: string | null;
  club_response: { idcliente?: number; origem?: string } | null;
}

const STATUS_LABEL: Record<string, string> = {
  dry_run: "Simulação enviada…",
  dry_run_ok: "Dry-run OK (não cadastrou de verdade)",
  submitting: "Cadastrando no Club…",
  submitted: "Cadastrado no iGreen Club",
  error: "Erro no cadastro Club",
};

export function ClubStatusTracker({ customerId, defaultCollapsed = false }: Props) {
  const [row, setRow] = useState<ClubRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  const load = async () => {
    const { data } = await supabase
      .from("customers")
      .select(
        "club_status, club_error, club_error_kind, club_dry_run, club_created_at, club_updated_at, club_response" as never,
      )
      .eq("id", customerId)
      .maybeSingle();
    setRow((data as unknown as ClubRow) || null);
    setLoading(false);
  };

  useEffect(() => {
    setLoading(true);
    void load();
    const ch = supabase
      .channel(`club-status-${customerId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "customers", filter: `id=eq.${customerId}` },
        (payload) => {
          const n = payload.new as Record<string, unknown>;
          setRow((prev) => ({
            club_status: (n.club_status as string) ?? prev?.club_status ?? null,
            club_error: (n.club_error as string) ?? prev?.club_error ?? null,
            club_error_kind: (n.club_error_kind as string) ?? prev?.club_error_kind ?? null,
            club_dry_run: (n.club_dry_run as boolean) ?? prev?.club_dry_run ?? null,
            club_created_at: (n.club_created_at as string) ?? prev?.club_created_at ?? null,
            club_updated_at: (n.club_updated_at as string) ?? prev?.club_updated_at ?? null,
            club_response: (n.club_response as ClubRow["club_response"]) ?? prev?.club_response ?? null,
          }));
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [customerId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div className="px-3 py-2 text-[10px] text-muted-foreground flex items-center gap-1.5">
        <Loader2 className="w-3 h-3 animate-spin" /> Status Club…
      </div>
    );
  }

  const status = row?.club_status;
  if (!status) {
    return (
      <div className="px-3 py-1.5 text-[10px] text-muted-foreground">
        Ainda não enviado ao iGreen Club
      </div>
    );
  }

  const idcliente = row?.club_response?.idcliente;
  const isOk = status === "submitted" || status === "dry_run_ok";
  const isErr = status === "error";
  const isBusy = status === "submitting" || status === "dry_run";

  return (
    <div className="border-b border-border/40">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/30"
      >
        {isBusy && <Loader2 className="w-3.5 h-3.5 animate-spin text-primary shrink-0" />}
        {isOk && <CheckCircle2 className="w-3.5 h-3.5 text-primary shrink-0" />}
        {isErr && <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0" />}
        {status === "dry_run_ok" && <FlaskConical className="w-3.5 h-3.5 text-warning shrink-0" />}
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold text-foreground truncate">
            {STATUS_LABEL[status] || status}
          </p>
          {idcliente ? (
            <p className="text-[10px] text-muted-foreground truncate">idcliente {idcliente}</p>
          ) : null}
        </div>
        {collapsed ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronUp className="w-3 h-3 text-muted-foreground" />}
      </button>
      {!collapsed && (
        <div className="px-3 pb-2 space-y-1 text-[10px] text-muted-foreground">
          {row?.club_error && (
            <p className="text-destructive leading-snug">{row.club_error}</p>
          )}
          {row?.club_error_kind && (
            <p>Tipo: {row.club_error_kind}</p>
          )}
          {row?.club_dry_run && status !== "submitted" && (
            <p className="text-warning">Modo dry-run — cliente não foi cadastrado de verdade.</p>
          )}
        </div>
      )}
    </div>
  );
}
