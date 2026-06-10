import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, ArrowLeft, Send, RefreshCw, Users, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { ReaquecimentoLeadList } from "@/components/admin/reaquecimento/ReaquecimentoLeadList";
import { ReaquecimentoTemplates } from "@/components/admin/reaquecimento/ReaquecimentoTemplates";
import { ReaquecimentoSendDialog } from "@/components/admin/reaquecimento/ReaquecimentoSendDialog";

/**
 * Painel de Reaquecimento — lista leads parados há ≥24h e permite:
 *   - Ver mensagens do lead
 *   - Enviar reaquecimento individual com template editável
 *   - Enviar em lote (múltiplos leads)
 *   - Configurar templates por conversation_step
 */
export default function AdminReaquecimento() {
  const navigate = useNavigate();
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [stepFilter, setStepFilter] = useState<string>("all");
  const [grouped, setGrouped] = useState<{ conversation_step: string; lead_count: number }[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [sendDialogMode, setSendDialogMode] = useState<"single" | "batch">("single");
  const [singleCustomerId, setSingleCustomerId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id;
      if (!uid) { navigate("/auth"); return; }
      if (!alive) return;
      setUserId(uid);
      await loadGrouped(uid);
      setLoading(false);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadGrouped(uid: string) {
    const { data, error } = await (supabase as any).rpc("stuck_leads_grouped_by_step", { p_consultant: uid });
    if (error) { console.error(error); return; }
    setGrouped((data as unknown as any[]) || []);
  }

  const totalStuck = useMemo(
    () => grouped.reduce((sum, g) => sum + Number(g.lead_count || 0), 0),
    [grouped],
  );

  function handleSendSingle(customerId: string) {
    setSingleCustomerId(customerId);
    setSendDialogMode("single");
    setSendDialogOpen(true);
  }

  function handleSendBatch() {
    if (selectedIds.size < 2) {
      toast.error("Selecione pelo menos 2 clientes interessados para enviar em lote");
      return;
    }
    if (selectedIds.size > 500) {
      toast.error("Selecione no máximo 500 clientes interessados por lote");
      return;
    }
    setSendDialogMode("batch");
    setSendDialogOpen(true);
  }

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b bg-card/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/admin")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <h1 className="text-base font-semibold">🔥 Reaquecimento de Clientes interessados</h1>
            <p className="text-xs text-muted-foreground">
              Clientes interessados parados há mais de 24 horas — reative com mensagem personalizada.
            </p>
          </div>
          <Badge variant="secondary" className="gap-1">
            <Users className="h-3 w-3" />
            {totalStuck} {totalStuck === 1 ? "lead parado" : "clientes interessados parados"}
          </Badge>
          {userId && (
            <Button variant="outline" size="sm" onClick={() => loadGrouped(userId)}>
              <RefreshCw className="mr-1 h-3 w-3" />
              Atualizar
            </Button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">
        <Tabs defaultValue="leads" className="w-full">
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="leads">Clientes interessados parados</TabsTrigger>
            <TabsTrigger value="templates">Templates</TabsTrigger>
          </TabsList>

          {/* LEADS */}
          <TabsContent value="leads" className="space-y-4 pt-4">
            {/* Filtros + ações em lote */}
            <div className="flex flex-wrap items-center gap-2">
              <Select value={stepFilter} onValueChange={setStepFilter}>
                <SelectTrigger className="w-[280px]">
                  <SelectValue placeholder="Filtrar por passo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os passos ({totalStuck})</SelectItem>
                  {grouped.map((g) => (
                    <SelectItem key={g.conversation_step} value={g.conversation_step}>
                      {g.conversation_step} ({g.lead_count})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {selectedIds.size > 0 && (
                <>
                  <Badge variant="outline">{selectedIds.size} selecionado(s)</Badge>
                  <Button size="sm" onClick={handleSendBatch}>
                    <Send className="mr-1 h-3 w-3" />
                    Enviar em lote
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>
                    Limpar seleção
                  </Button>
                </>
              )}
            </div>

            {totalStuck === 0 ? (
              <Card className="p-12 text-center">
                <AlertCircle className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Nenhum cliente interessado parado há mais de 24 horas. Bom trabalho! 🎉
                </p>
              </Card>
            ) : (
              userId && (
                <ReaquecimentoLeadList
                  consultantId={userId}
                  stepFilter={stepFilter === "all" ? null : stepFilter}
                  selectedIds={selectedIds}
                  onSelectionChange={setSelectedIds}
                  onSendSingle={handleSendSingle}
                />
              )
            )}
          </TabsContent>

          {/* TEMPLATES */}
          <TabsContent value="templates" className="pt-4">
            {userId && <ReaquecimentoTemplates consultantId={userId} availableSteps={grouped.map((g) => g.conversation_step)} />}
          </TabsContent>
        </Tabs>
      </main>

      {sendDialogOpen && userId && (
        <ReaquecimentoSendDialog
          open={sendDialogOpen}
          onOpenChange={(o) => {
            setSendDialogOpen(o);
            if (!o) {
              setSingleCustomerId(null);
              loadGrouped(userId); // refresh contagens após envio
            }
          }}
          mode={sendDialogMode}
          consultantId={userId}
          customerId={sendDialogMode === "single" ? singleCustomerId : null}
          customerIds={sendDialogMode === "batch" ? Array.from(selectedIds) : []}
          onSendComplete={() => {
            setSelectedIds(new Set());
          }}
        />
      )}
    </div>
  );
}
