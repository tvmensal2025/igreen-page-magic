// Painel do super-admin: aprovar/rejeitar templates de fluxo enviados pelos
// consultores. Só quem é super-admin enxerga e age aqui (RLS + RPC
// `review_flow_template` validam no banco). Mostra os pendentes primeiro.
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Loader2, Check, X, RefreshCw, User, Phone, Inbox } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { usePrompt } from "@/components/ui/prompt-dialog";

interface Row {
  id: string;
  name: string;
  description: string | null;
  author_name: string | null;
  author_phone: string | null;
  show_phone: boolean;
  status: "pending" | "approved" | "rejected";
  variant: string;
  steps_count: number;
  created_at: string;
}

export default function FlowTemplateApprovalPanel() {
  const prompt = usePrompt();
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [actingId, setActingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("flow_template_submissions")
        .select("id, name, description, author_name, author_phone, show_phone, status, variant, steps_snapshot, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      const mapped: Row[] = ((data as any[]) || []).map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        author_name: r.author_name,
        author_phone: r.author_phone,
        show_phone: r.show_phone,
        status: r.status,
        variant: r.variant,
        steps_count: Array.isArray(r.steps_snapshot) ? r.steps_snapshot.length : 0,
        created_at: r.created_at,
      }));
      // Pendentes primeiro.
      mapped.sort((a, b) => (a.status === "pending" ? -1 : 1) - (b.status === "pending" ? -1 : 1));
      setRows(mapped);
    } catch (e: any) {
      toast.error("Erro ao carregar: " + (e?.message || String(e)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function review(row: Row, approve: boolean) {
    let note: string | null = null;
    if (!approve) {
      note = await prompt({
        title: "Rejeitar template",
        description: "Opcional: explique o motivo (o autor poderá ver).",
        placeholder: "Motivo da rejeição",
        confirmText: "Rejeitar",
      });
      if (note === null) return; // cancelou
    }
    setActingId(row.id);
    try {
      const { error } = await (supabase as any).rpc("review_flow_template", {
        _submission_id: row.id,
        _approve: approve,
        _note: note,
      });
      if (error) throw error;
      toast.success(approve ? "Template aprovado e publicado na galeria." : "Template rejeitado.");
      await load();
    } catch (e: any) {
      toast.error("Erro: " + (e?.message || String(e)));
    } finally {
      setActingId(null);
    }
  }

  const pending = rows.filter((r) => r.status === "pending");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Templates de fluxo</h2>
          <p className="text-sm text-muted-foreground">
            Aprove ou rejeite os modelos enviados pelos consultores. Os aprovados
            aparecem na galeria para todos.
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {pending.length > 0 && (
        <Badge variant="secondary" className="text-xs">
          {pending.length} aguardando aprovação
        </Badge>
      )}

      {loading ? (
        <div className="grid h-40 place-items-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : rows.length === 0 ? (
        <Card className="grid place-items-center gap-2 p-10 text-center">
          <Inbox className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Nenhum template enviado ainda.</p>
        </Card>
      ) : (
        <div className="grid gap-3">
          {rows.map((row) => (
            <Card key={row.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-sm font-semibold">{row.name}</h3>
                    <StatusBadge status={row.status} />
                    <Badge variant="outline" className="text-[10px]">
                      {row.steps_count} {row.steps_count === 1 ? "passo" : "passos"}
                    </Badge>
                  </div>
                  {row.description && (
                    <p className="mt-1 text-xs text-muted-foreground">{row.description}</p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <User className="h-3 w-3" />
                      {row.author_name || "Consultor"}
                    </span>
                    {row.show_phone && row.author_phone && (
                      <span className="inline-flex items-center gap-1">
                        <Phone className="h-3 w-3" />
                        {row.author_phone}
                      </span>
                    )}
                  </div>
                </div>

                {row.status === "pending" && (
                  <div className="flex shrink-0 gap-2">
                    <Button
                      size="sm"
                      onClick={() => review(row, true)}
                      disabled={actingId === row.id}
                    >
                      {actingId === row.id ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1 h-3.5 w-3.5" />}
                      Aprovar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive"
                      onClick={() => review(row, false)}
                      disabled={actingId === row.id}
                    >
                      <X className="mr-1 h-3.5 w-3.5" />
                      Rejeitar
                    </Button>
                  </div>
                )}
                {row.status === "approved" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-destructive"
                    onClick={() => review(row, false)}
                    disabled={actingId === row.id}
                  >
                    Remover da galeria
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: Row["status"] }) {
  if (status === "approved") return <Badge className="bg-primary/15 text-primary hover:bg-primary/15 text-[10px]">Na galeria</Badge>;
  if (status === "rejected") return <Badge variant="outline" className="text-[10px] text-muted-foreground">Rejeitado</Badge>;
  return <Badge variant="secondary" className="text-[10px]">Pendente</Badge>;
}
