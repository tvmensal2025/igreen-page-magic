import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, GitBranch } from "lucide-react";

// Card único e definitivo de "quais fluxos este consultor entrega ao lead".
// Substitui o antigo radio A_ONLY/D_ONLY/M_ONLY/BOTH — agora cada variante
// é um switch independente, com regra "no mínimo 1 ativo".
//
// Fonte da verdade: `consultants.active_variants text[]`.
// `assign_flow_variant` (SQL) só sorteia entre variantes que estão no array
// E têm bot_flow ativo (próprio do consultor OU público, caso do M).

interface Props {
  consultantId: string;
}

interface VariantInfo {
  variant: string;
  label: string;
  description: string;
  source: "consultant" | "public";
  flowName: string | null;
}

const VARIANT_META: Record<string, { label: string; description: string }> = {
  A: { label: "Fluxo A — CEMIG (cadastro direto)", description: "Vai direto em 'envie sua conta de luz'. Use para campanhas muito qualificadas." },
  B: { label: "Fluxo B — IA livre (Camila)", description: "IA conduz toda a conversa até pedir a foto da conta." },
  C: { label: "Fluxo C — Sofia Multicanal", description: "10 passos Grupo A: nome → valor → ativar → OCR → portal OTP + facial. Áudio Sofia TTS." },
  D: { label: "Fluxo D — Botões guiados", description: "Roteiro fixo conversacional. Roteia para CEMIG quando lead pede cadastro." },
  M: { label: "Fluxo M — MG (Minas Gerais)", description: "Fluxo público mantido pelo Super Admin. Simulação com desconto 10–28%." },
  E: { label: "Fluxo E — Personalizado", description: "Fluxo customizado pelo consultor." },
};

export default function ConsultantVariantsCard({ consultantId }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [active, setActive] = useState<string[]>([]);
  const [available, setAvailable] = useState<VariantInfo[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    setLoading(true);

    // 1. active_variants atual
    const { data: c } = await supabase
      .from("consultants")
      .select("active_variants")
      .eq("id", consultantId)
      .maybeSingle();
    const arr = (((c as any)?.active_variants) || []) as string[];
    setActive(arr.map((s) => String(s).toUpperCase()));

    // 2. Variantes disponíveis: bot_flows deste consultor OU públicos ativos
    const { data: flows } = await supabase
      .from("bot_flows")
      .select("variant, name, is_public, consultant_id, is_active")
      .eq("is_active", true)
      .or(`consultant_id.eq.${consultantId},is_public.eq.true`);

    const map = new Map<string, VariantInfo>();
    for (const f of ((flows as any[]) || [])) {
      const v = String(f.variant || "").toUpperCase();
      if (!v) continue;
      // Consultor tem prioridade sobre público
      if (map.has(v) && f.consultant_id !== consultantId) continue;
      const meta = VARIANT_META[v] || { label: `Fluxo ${v}`, description: "" };
      map.set(v, {
        variant: v,
        label: meta.label,
        description: meta.description,
        source: f.consultant_id === consultantId ? "consultant" : "public",
        flowName: f.name || null,
      });
    }
    const avail = Array.from(map.values()).sort((a, b) => a.variant.localeCompare(b.variant));
    setAvailable(avail);

    // 3. Contagem últimos 7 dias por variante
    const since = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
    const counters: Record<string, number> = {};
    await Promise.all(
      avail.map(async (v) => {
        const { count } = await supabase
          .from("customers")
          .select("id", { count: "exact", head: true })
          .eq("consultant_id", consultantId)
          .eq("flow_variant", v.variant)
          .gte("created_at", since);
        counters[v.variant] = count ?? 0;
      }),
    );
    setCounts(counters);

    setLoading(false);
  }, [consultantId]);

  useEffect(() => { load(); }, [load]);

  async function toggle(v: string, on: boolean) {
    const set = new Set(active);
    if (on) set.add(v);
    else {
      if (active.length <= 1 && active.includes(v)) {
        toast.error("Pelo menos 1 fluxo precisa estar ativo.", { id: `flow-${v}` });
        return;
      }
      set.delete(v);
    }
    const next = available.map((a) => a.variant).filter((x) => set.has(x));
    setSaving(v);
    const { error } = await supabase
      .from("consultants")
      .update({ active_variants: next })
      .eq("id", consultantId);
    setSaving(null);
    if (error) {
      toast.error(error.message, { id: `flow-${v}` });
      return;
    }
    setActive(next);
    toast.success(
      on ? `✅ Fluxo ${v} recebendo leads` : `⏸️ Fluxo ${v} pausado (continua editável)`,
      { id: `flow-${v}`, duration: 2500 },
    );
    // Recarrega do banco para não ficar "preso" caso alguém tenha alterado em outra aba
    await load();
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex justify-center p-8"><Loader2 className="animate-spin" /></CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GitBranch className="w-5 h-5 text-primary" />
          Distribuição de Fluxo
        </CardTitle>
        <CardDescription>
          Cada lead novo entra em um dos fluxos ligados abaixo (round-robin).
          Fluxos desligados continuam editáveis, mas não recebem clientes.
          {" "}
          <span className="text-xs">
            Total ativo agora:{" "}
            <Badge variant="secondary">{active.length} fluxo{active.length === 1 ? "" : "s"}</Badge>
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {available.length === 0 && (
          <p className="text-sm text-muted-foreground italic">
            Nenhum fluxo disponível para este consultor. Crie um em /admin/fluxos.
          </p>
        )}
        {available.map((v) => {
          const isOn = active.includes(v.variant);
          const isBusy = saving === v.variant;
          return (
            <div
              key={v.variant}
              className={`flex items-start gap-3 p-3 border rounded-md transition ${
                isOn ? "border-primary/50 bg-primary/5" : "border-border bg-background"
              }`}
            >
              <div className="mt-1">
                {isBusy ? (
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                ) : (
                  <Switch checked={isOn} onCheckedChange={(c) => toggle(v.variant, c)} />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <Label className="cursor-pointer flex items-center gap-2 flex-wrap">
                  <span className="font-medium">{v.label}</span>
                  {v.source === "public" && (
                    <Badge variant="outline" className="text-[10px]">público — Super Admin</Badge>
                  )}
                  <Badge variant="outline" className="text-[10px]">
                    7d: {counts[v.variant] ?? 0} lead{(counts[v.variant] ?? 0) === 1 ? "" : "s"}
                  </Badge>
                </Label>
                <p className="text-xs text-muted-foreground mt-0.5">{v.description}</p>
                {v.flowName && v.source === "consultant" && (
                  <p className="text-[10px] text-muted-foreground mt-0.5 italic">
                    nome interno: {v.flowName}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
