import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { CampaignTemplate, slugify } from "@/lib/campaignTemplate";

type Draft = Omit<CampaignTemplate, "id" | "consultant_id" | "created_at" | "updated_at"> & {
  id?: string;
};

interface Props {
  open: boolean;
  initial: Draft | null;
  onClose: () => void;
  onSave: (draft: Draft) => Promise<void> | void;
}

const EMPTY: Draft = {
  name: "",
  anchor_city: "",
  radius_km: 50,
  age_min: 28,
  age_max: 65,
  interests: [],
  daily_budget_brl: 50,
  creative_title: "",
  copy_text: "",
  video_url: "",
  destination_url: "https://igreen.cloud/",
  utm_campaign: "",
  observations: "",
};

export function CampaignTemplateForm({ open, initial, onClose, onSave }: Props) {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setDraft(initial ?? EMPTY);
  }, [open, initial]);

  const update = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    try {
      const finalDraft: Draft = {
        ...draft,
        utm_campaign: draft.utm_campaign || slugify(draft.name),
      };
      await onSave(finalDraft);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial?.id ? "Editar template" : "Novo template de campanha"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>Nome do template</Label>
            <Input value={draft.name} onChange={(e) => update("name", e.target.value)} placeholder="Ex: Uberlândia 100km — 28% Análise" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <Label>Cidade-âncora</Label>
              <Input value={draft.anchor_city} onChange={(e) => update("anchor_city", e.target.value)} placeholder="Uberlândia, MG" />
            </div>
            <div>
              <Label>Raio (km)</Label>
              <Input type="number" min={1} max={100} value={draft.radius_km} onChange={(e) => update("radius_km", Number(e.target.value))} />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div>
              <Label>Idade mín.</Label>
              <Input type="number" min={13} max={65} value={draft.age_min} onChange={(e) => update("age_min", Number(e.target.value))} />
            </div>
            <div>
              <Label>Idade máx.</Label>
              <Input type="number" min={13} max={65} value={draft.age_max} onChange={(e) => update("age_max", Number(e.target.value))} />
            </div>
            <div>
              <Label>Orçamento/dia (R$)</Label>
              <Input type="number" min={1} step="0.01" value={draft.daily_budget_brl} onChange={(e) => update("daily_budget_brl", Number(e.target.value))} />
            </div>
          </div>

          <div>
            <Label>Interesses (1 por linha)</Label>
            <Textarea
              rows={4}
              value={draft.interests.join("\n")}
              onChange={(e) => update("interests", e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))}
              placeholder={"Proprietários de imóveis\nConta de luz / Cemig"}
            />
          </div>

          <div>
            <Label>Título do criativo</Label>
            <Input value={draft.creative_title} onChange={(e) => update("creative_title", e.target.value)} />
          </div>

          <div>
            <Label>Copy principal</Label>
            <Textarea rows={4} value={draft.copy_text} onChange={(e) => update("copy_text", e.target.value)} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>URL do vídeo (link)</Label>
              <Input value={draft.video_url} onChange={(e) => update("video_url", e.target.value)} placeholder="https://..." />
            </div>
            <div>
              <Label>URL de destino</Label>
              <Input value={draft.destination_url} onChange={(e) => update("destination_url", e.target.value)} placeholder="https://igreen.cloud/" />
            </div>
          </div>

          <div>
            <Label>UTM campaign (auto a partir do nome se vazio)</Label>
            <Input value={draft.utm_campaign} onChange={(e) => update("utm_campaign", e.target.value)} placeholder={slugify(draft.name) || "uberlandia_100km"} />
          </div>

          <div>
            <Label>Observações</Label>
            <Textarea rows={3} value={draft.observations} onChange={(e) => update("observations", e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving || !draft.name.trim()}>
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
