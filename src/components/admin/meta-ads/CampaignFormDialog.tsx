import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

interface Campaign {
  id?: string;
  name: string;
  fb_campaign_id: string | null;
  initial_message: string | null;
  status: string;
  daily_budget_cents: number;
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  consultantId: string;
  campaign?: Campaign | null;
  onSaved: () => void;
}

const EMPTY: Campaign = {
  name: "",
  fb_campaign_id: null,
  initial_message: "",
  status: "active",
  daily_budget_cents: 0,
};

export function CampaignFormDialog({ open, onOpenChange, consultantId, campaign, onSaved }: Props) {
  const [form, setForm] = useState<Campaign>(EMPTY);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setForm(campaign || EMPTY);
  }, [open, campaign]);

  function setField<K extends keyof Campaign>(k: K, v: Campaign[K]) {
    setForm((prev) => ({ ...prev, [k]: v }));
  }

  async function handleSave() {
    // Validações (Reqs 6.1-6.3)
    if (!form.name.trim() || form.name.length > 100) {
      toast.error("Nome obrigatório (1-100 caracteres)");
      return;
    }
    if (!form.initial_message || form.initial_message.trim().length < 5) {
      toast.error("Mensagem inicial obrigatória (mín. 5 caracteres)");
      return;
    }
    if (form.initial_message.length > 1000) {
      toast.error("Mensagem inicial muito longa (max 1000)");
      return;
    }

    setSaving(true);

    try {
      // Verifica duplicidade de fb_campaign_id (Req 6.3)
      if (form.fb_campaign_id) {
        const { data: existing } = await supabase
          .from("facebook_campaigns")
          .select("id")
          .eq("consultant_id", consultantId)
          .eq("fb_campaign_id", form.fb_campaign_id)
          .neq("id", form.id || "")
          .maybeSingle();
        if (existing) {
          toast.error("Já existe campanha com esse fb_campaign_id");
          setSaving(false);
          return;
        }
      }

      if (form.id) {
        // Update (Req 6.4)
        const { error } = await supabase
          .from("facebook_campaigns")
          .update({
            name: form.name,
            initial_message: form.initial_message,
            status: form.status,
            daily_budget_cents: form.daily_budget_cents,
            updated_at: new Date().toISOString(),
          })
          .eq("id", form.id);
        if (error) throw error;
        toast.success("Campanha atualizada");
      } else {
        // Insert
        const { error } = await supabase.from("facebook_campaigns").insert({
          consultant_id: consultantId,
          name: form.name,
          fb_campaign_id: form.fb_campaign_id || null,
          initial_message: form.initial_message,
          status: form.status,
          daily_budget_cents: form.daily_budget_cents || 0,
          cities: [],
          fb_adset_ids: [],
          fb_ad_ids: [],
        });
        if (error) throw error;
        toast.success("Campanha criada");
      }

      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast.error("Erro: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{form.id ? "Editar campanha" : "Nova campanha Meta Ads"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="text-xs">Nome da campanha *</Label>
            <Input
              value={form.name}
              onChange={(e) => setField("name", e.target.value)}
              maxLength={100}
              placeholder="Ex: Solar SP - Set 2025"
            />
          </div>

          <div>
            <Label className="text-xs">Código da campanha do Meta (opcional)</Label>
            <Input
              value={form.fb_campaign_id || ""}
              onChange={(e) => setField("fb_campaign_id", e.target.value || null)}
              placeholder="123456789012"
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              Cole o código da campanha do Gerenciador de Anúncios do Meta (opcional, ajuda a vincular os clientes interessados que vieram do anúncio).
            </p>
          </div>

          <div>
            <Label className="text-xs">Mensagem inicial * (texto pré-preenchido do anúncio)</Label>
            <Textarea
              rows={3}
              value={form.initial_message || ""}
              onChange={(e) => setField("initial_message", e.target.value)}
              maxLength={1000}
              placeholder="Quero saber mais sobre a economia de até 20% na conta de luz."
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              Esta é a frase que o cliente interessado manda ao clicar no anúncio. Usada pra atribuir cliente interessado à campanha.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={form.status} onValueChange={(v) => setField("status", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Ativa</SelectItem>
                  <SelectItem value="paused">Pausada</SelectItem>
                  <SelectItem value="archived">Arquivada</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Orçamento diário (R$)</Label>
              <Input
                type="number"
                min={0}
                value={(form.daily_budget_cents || 0) / 100}
                onChange={(e) =>
                  setField("daily_budget_cents", Math.round(Number(e.target.value || 0) * 100))
                }
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Salvando…" : form.id ? "Atualizar" : "Criar"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
