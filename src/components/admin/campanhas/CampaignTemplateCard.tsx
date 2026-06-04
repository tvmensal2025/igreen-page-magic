import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Copy, Download, Pencil, Trash2, Files, MapPin, DollarSign } from "lucide-react";
import { toast } from "sonner";
import { CampaignTemplate, generateMetaAdsConfig } from "@/lib/campaignTemplate";

interface Props {
  template: CampaignTemplate;
  onEdit: (t: CampaignTemplate) => void;
  onDuplicate: (t: CampaignTemplate) => void;
  onDelete: (t: CampaignTemplate) => void;
}

export function CampaignTemplateCard({ template, onEdit, onDuplicate, onDelete }: Props) {
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(generateMetaAdsConfig(template));
      toast.success("Configuração copiada! Cole no Meta Ads Manager.");
    } catch {
      toast.error("Não foi possível copiar. Tente exportar.");
    }
  };

  const handleExport = () => {
    const text = generateMetaAdsConfig(template);
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${template.name.replace(/[^a-z0-9]+/gi, "_")}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card className="p-4 sm:p-5 space-y-3 hover:border-primary/40 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-heading font-bold text-base sm:text-lg leading-tight">{template.name}</h3>
        <Badge variant="secondary" className="shrink-0">Meta</Badge>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{template.anchor_city || "—"} · {template.radius_km}km</span>
        <span className="inline-flex items-center gap-1"><DollarSign className="w-3.5 h-3.5" />R$ {template.daily_budget_brl.toFixed(2)}/dia</span>
        <span>{template.age_min}–{template.age_max} anos</span>
      </div>

      {template.creative_title && (
        <div className="text-sm">
          <div className="text-muted-foreground text-xs">Título</div>
          <div className="font-medium">{template.creative_title}</div>
        </div>
      )}

      {template.copy_text && (
        <p className="text-xs text-muted-foreground line-clamp-3">{template.copy_text}</p>
      )}

      <div className="flex flex-wrap gap-2 pt-2">
        <Button size="sm" onClick={handleCopy} className="gap-1.5">
          <Copy className="w-3.5 h-3.5" /> Copiar configuração
        </Button>
        <Button size="sm" variant="outline" onClick={handleExport} className="gap-1.5">
          <Download className="w-3.5 h-3.5" /> .txt
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onDuplicate(template)} className="gap-1.5">
          <Files className="w-3.5 h-3.5" /> Duplicar
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onEdit(template)} className="gap-1.5">
          <Pencil className="w-3.5 h-3.5" /> Editar
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onDelete(template)} className="gap-1.5 text-destructive hover:text-destructive">
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
    </Card>
  );
}
