import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MapPin, Users, DollarSign, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AdTemplate } from "@/services/adTemplates";
import { SmartPublishButton } from "./SmartPublishButton";
import { UseTemplateDialog } from "./UseTemplateDialog";
import { Button } from "@/components/ui/button";

interface Props {
  consultantId: string;
  onPublished?: () => void;
}

/**
 * Atalho "Replicar campanha Uberlândia 100km — 28% Análise".
 * Carrega o template de plataforma (consultant_id IS NULL, título começando com
 * "Uberlândia + 100km") e oferece publicar com 1 clique via SmartPublish,
 * ou personalizar via UseTemplateDialog. Não aparece se o template não existir.
 */
export function ReplicateUberlandiaCard({ consultantId, onPublished }: Props) {
  const [tpl, setTpl] = useState<AdTemplate | null>(null);
  const [fallbackOpen, setFallbackOpen] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("ad_templates")
        .select("*")
        .ilike("title", "Uberlândia + 100km%")
        .eq("status", "published")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) setTpl(data as unknown as AdTemplate);
    })();
  }, []);

  if (!tpl) return null;

  return (
    <>
      <Card className="p-4 sm:p-5 bg-gradient-to-br from-primary/10 via-card to-card border-primary/30">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
            <Sparkles className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-heading font-bold text-sm sm:text-base leading-tight">
                    Replicar campanha Uberlândia + 100 km
                  </h3>
                  <Badge variant="secondary" className="text-[10px]">Recomendado</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Mesmo vídeo de 28% · cidades de MG num raio de 100 km · publica em 1 clique.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3" />{tpl.target_cidades?.length || 0} cidades MG</span>
              <span className="inline-flex items-center gap-1"><DollarSign className="w-3 h-3" />R$ {(tpl.suggested_daily_budget_cents / 100).toFixed(0)}/dia</span>
              <span className="inline-flex items-center gap-1"><Users className="w-3 h-3" />{tpl.age_min}–{tpl.age_max} anos</span>
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              <div className="flex-1 min-w-[180px]">
                <SmartPublishButton
                  template={tpl}
                  consultantId={consultantId}
                  onPublished={onPublished}
                  onFallback={() => setFallbackOpen(true)}
                />
              </div>
              <Button size="sm" variant="outline" onClick={() => setFallbackOpen(true)}>
                Personalizar
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <UseTemplateDialog
        open={fallbackOpen}
        onClose={() => setFallbackOpen(false)}
        template={tpl}
        consultantId={consultantId}
        onPublished={() => { setFallbackOpen(false); onPublished?.(); }}
      />
    </>
  );
}
