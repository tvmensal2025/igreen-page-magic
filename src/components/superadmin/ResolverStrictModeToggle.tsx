// F2 — Resolver strict mode toggle.
// Quando ATIVO, o bot-flow não reseta leads para "aguardando_conta" quando
// um custom step não tem mapeamento. Mantém o step e apenas loga warn.
// Default OFF — ligar só depois de validar com 1 consultor.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { ShieldCheck, Loader2 } from "lucide-react";

export function ResolverStrictModeToggle() {
  const { toast } = useToast();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const { data } = await supabase
      .from("app_settings")
      .select("resolver_strict_mode")
      .eq("id", "global")
      .maybeSingle();
    setEnabled(data ? !!(data as any).resolver_strict_mode : false);
  };

  useEffect(() => { void load(); }, []);

  const toggle = async () => {
    if (enabled === null) return;
    setSaving(true);
    try {
      const next = !enabled;
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("app_settings")
        .update({ resolver_strict_mode: next, updated_at: new Date().toISOString(), updated_by: user?.id ?? null })
        .eq("id", "global");
      if (error) throw error;
      setEnabled(next);
      toast({
        title: next ? "Resolver strict mode ATIVO" : "Resolver strict mode DESLIGADO",
        description: next
          ? "Clientes interessados com step custom sem mapeamento não serão mais resetados para aguardando_conta."
          : "Comportamento padrão: clientes interessados sem mapeamento voltam para aguardando_conta.",
      });
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (enabled === null) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Carregando…
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <div className={`p-2 rounded-lg ${enabled ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>
          <ShieldCheck className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-sm">Resolver Strict Mode</h3>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${enabled ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}>
              {enabled ? "ATIVO" : "DESLIGADO"}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Quando ativo, clientes interessados com step custom sem mapeamento legacy NÃO voltam para "aguardando_conta" — mantém o step e loga warn. Ligar só após validar com 1 consultor piloto.
          </p>
        </div>
        <Button size="sm" variant={enabled ? "destructive" : "default"} disabled={saving} onClick={() => void toggle()} className="shrink-0">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : enabled ? "Desligar" : "Ativar"}
        </Button>
      </div>
    </div>
  );
}
