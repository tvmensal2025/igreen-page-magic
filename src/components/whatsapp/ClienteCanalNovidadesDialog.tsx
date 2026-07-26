import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { MessageCircleHeart, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { DEFAULT_CLIENTE_CANAL_REPLY } from "@/lib/clienteCanalNovidades";

type FlowOpt = { id: string; name: string; variant: string };

export default function ClienteCanalNovidadesDialog({ consultantId }: { consultantId: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [text, setText] = useState(DEFAULT_CLIENTE_CANAL_REPLY);
  const [flowId, setFlowId] = useState<string>("none");
  const [flows, setFlows] = useState<FlowOpt[]>([]);

  async function load() {
    setLoading(true);
    const [prefsRes, flowsRes] = await Promise.all([
      supabase
        .from("consultant_automation_prefs")
        .select("cliente_canal_reply_enabled, cliente_canal_reply_text, cliente_canal_flow_id")
        .eq("consultant_id", consultantId)
        .maybeSingle(),
      supabase
        .from("bot_flows")
        .select("id, name, variant")
        .eq("consultant_id", consultantId)
        .eq("is_active", true)
        .order("name"),
    ]);
    const prefs = prefsRes.data as {
      cliente_canal_reply_enabled?: boolean;
      cliente_canal_reply_text?: string | null;
      cliente_canal_flow_id?: string | null;
    } | null;
    setEnabled(prefs?.cliente_canal_reply_enabled !== false);
    setText(prefs?.cliente_canal_reply_text?.trim() || DEFAULT_CLIENTE_CANAL_REPLY);
    setFlowId(prefs?.cliente_canal_flow_id || "none");
    setFlows(((flowsRes.data as FlowOpt[]) || []).filter(Boolean));
    setLoading(false);
  }

  useEffect(() => {
    if (open) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, consultantId]);

  async function save() {
    setSaving(true);
    const { data: existing } = await supabase
      .from("consultant_automation_prefs")
      .select(
        "group_a_enabled, group_b_enabled, group_c_enabled, pos_venda_auto_enabled, pos_venda_auto_validate, reminders_auto_enabled, acked_at",
      )
      .eq("consultant_id", consultantId)
      .maybeSingle();

    const payload = {
      consultant_id: consultantId,
      group_a_enabled: !!(existing as any)?.group_a_enabled,
      group_b_enabled: !!(existing as any)?.group_b_enabled,
      group_c_enabled: !!(existing as any)?.group_c_enabled,
      pos_venda_auto_enabled: !!(existing as any)?.pos_venda_auto_enabled,
      pos_venda_auto_validate: !!(existing as any)?.pos_venda_auto_validate,
      reminders_auto_enabled: !!(existing as any)?.reminders_auto_enabled,
      acked_at: (existing as any)?.acked_at ?? new Date().toISOString(),
      cliente_canal_reply_enabled: enabled,
      cliente_canal_reply_text: text.trim() || null,
      cliente_canal_flow_id: flowId === "none" ? null : flowId,
      updated_at: new Date().toISOString(),
      updated_by: consultantId,
    };
    const { error } = await supabase
      .from("consultant_automation_prefs")
      .upsert(payload as any, { onConflict: "consultant_id" });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Canal de novidades salvo");
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2 rounded-xl min-h-[44px]">
          <MessageCircleHeart className="w-4 h-4 shrink-0" />
          <span className="lg:hidden">Novidades</span>
          <span className="hidden lg:inline">Canal novidades</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Canal de novidades (clientes)</DialogTitle>
          <DialogDescription>
            Quando um cliente da carteira responder no WhatsApp, ele <strong>não entra no Grupo A</strong>
            {" "}nem em cadastro. Recebe esta mensagem de recados/novidades.
            Você pode reservar um fluxo para o futuro (ainda não dispara).
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
            Carregando…
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2.5">
              <div className="min-w-0">
                <Label htmlFor="canal-on" className="text-sm font-medium">
                  Responder clientes automaticamente
                </Label>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Liga a mensagem de novidades quando o cliente falar neste Zap.
                </p>
              </div>
              <Switch id="canal-on" checked={enabled} onCheckedChange={setEnabled} />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Fluxo reservado (opcional — ainda não criado / não dispara)</Label>
              <Select value={flowId} onValueChange={setFlowId}>
                <SelectTrigger className="rounded-xl">
                  <SelectValue placeholder="Nenhum por enquanto" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhum — só a mensagem de novidades</SelectItem>
                  {flows.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.name} ({f.variant})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Quando criar o fluxo de novidades, selecione aqui. Enquanto isso, só a mensagem abaixo sai.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Mensagem se o cliente responder</Label>
              <Textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={14}
                className="font-mono text-xs leading-relaxed rounded-xl"
              />
              <p className="text-[11px] text-muted-foreground">
                Use <code className="text-[10px]">{"{{saudacao}}"}</code> para “, Nome” quando o nome for confiável.
                Cooldown de 12h entre respostas automáticas.
              </p>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={() => void save()} disabled={saving || loading} className="gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
