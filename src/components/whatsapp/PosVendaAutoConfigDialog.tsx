import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Settings2, MessageSquare, Loader2 } from "lucide-react";
import { StageAutoMessageConfig } from "./StageAutoMessageConfig";

interface PvStage {
  id: string;
  stage_key: string;
  label: string;
  color: string;
  auto_message_enabled: boolean;
  auto_message_text: string | null;
  auto_message_type: string;
  auto_message_media_url: string | null;
  auto_message_image_url: string | null;
}

const PV_STAGE_ORDER = ["pv_espera", "pv_aprovado", "pv_reprovado", "pv_d30", "pv_d60", "pv_d90", "pv_d120"];

export default function PosVendaAutoConfigDialog({ consultantId }: { consultantId: string }) {
  const [open, setOpen] = useState(false);
  const [stages, setStages] = useState<PvStage[]>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("kanban_stages")
      .select("id, stage_key, label, color, auto_message_enabled, auto_message_text, auto_message_type, auto_message_media_url, auto_message_image_url")
      .eq("consultant_id", consultantId)
      .eq("stage_scope", "pos_venda");
    const ordered = (data || []).slice().sort(
      (a: any, b: any) => PV_STAGE_ORDER.indexOf(a.stage_key) - PV_STAGE_ORDER.indexOf(b.stage_key),
    );
    setStages(ordered as PvStage[]);
    setLoading(false);
  }

  useEffect(() => { if (open) load(); }, [open, consultantId]);

  async function toggleEnabled(stage: PvStage, value: boolean) {
    setStages((prev) => prev.map((s) => s.id === stage.id ? { ...s, auto_message_enabled: value } : s));
    await supabase.from("kanban_stages").update({ auto_message_enabled: value }).eq("id", stage.id);
  }

  async function patchStage(stage: PvStage, patch: Partial<PvStage>) {
    setStages((prev) => prev.map((s) => s.id === stage.id ? { ...s, ...patch } : s));
    await supabase.from("kanban_stages").update(patch as any).eq("id", stage.id);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2 rounded-xl">
          <Settings2 className="w-4 h-4" />
          Autoprogressão
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Mensagens automáticas do Pós-Venda</DialogTitle>
          <DialogDescription>
            Configure o que o cliente recebe ao entrar em cada coluna. Os envios usam a conexão
            de WhatsApp do consultor e, se indisponível, a conexão compartilhada.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
            Carregando…
          </div>
        ) : (
          <div className="space-y-2">
            {stages.map((s) => (
              <div
                key={s.id}
                className="flex items-center gap-3 p-3 rounded-lg border border-border/60 bg-card/50"
              >
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: s.color || "#888" }}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{s.label}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {s.auto_message_enabled ? (
                      <Badge variant="secondary" className="text-[9px] bg-primary/15 text-primary border-primary/30">
                        <MessageSquare className="w-2.5 h-2.5 mr-0.5" /> ativa
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[9px] text-muted-foreground">desativada</Badge>
                    )}
                    <span className="text-[10px] text-muted-foreground">key: {s.stage_key}</span>
                  </div>
                </div>
                <Switch
                  checked={s.auto_message_enabled}
                  onCheckedChange={(v) => toggleEnabled(s, v)}
                />
                <StageAutoMessageConfig
                  stageId={s.id}
                  stageLabel={s.label}
                  stageKey={s.stage_key}
                  consultantId={consultantId}
                  autoMessageText={s.auto_message_text}
                  autoMessageType={s.auto_message_type || "text"}
                  autoMessageMediaUrl={s.auto_message_media_url}
                  autoMessageImageUrl={s.auto_message_image_url}
                  onSave={(text, type, mediaUrl, imageUrl) => patchStage(s, {
                    auto_message_text: text,
                    auto_message_type: type,
                    auto_message_media_url: mediaUrl,
                    auto_message_image_url: imageUrl,
                  })}
                />
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
