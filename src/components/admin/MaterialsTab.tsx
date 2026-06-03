import { useState } from "react";
import { FolderOpen, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  MATERIALS_BY_SECTION,
  SECTION_LABEL,
  SECTIONS_IN_ORDER,
  type MaterialSection,
} from "@/lib/materialsCatalog";
import { MaterialCard } from "./materials/MaterialCard";

const DRIVE_URL = "https://drive.google.com/drive/folders/1KupNLRpZaJwHfgRUgbWV-cGYQenreSfu";

interface Props {
  consultantId?: string | null;
}

export function MaterialsTab({ consultantId = null }: Props) {
  const sectionsWithItems = SECTIONS_IN_ORDER.filter(
    (s) => (MATERIALS_BY_SECTION[s] || []).length > 0,
  );
  const [active, setActive] = useState<MaterialSection>(sectionsWithItems[0]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <FolderOpen className="w-5 h-5 text-primary" />
          <h2 className="font-heading font-bold text-foreground text-lg">Materiais para Download</h2>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => window.open(DRIVE_URL, "_blank", "noopener,noreferrer")}
          className="gap-2"
        >
          <ExternalLink className="w-4 h-4" />
          Materiais extras no Drive
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">
        Vídeos e imagens das páginas do site, prontos para baixar ou enviar via WhatsApp pros seus clientes.
      </p>

      <Tabs value={active} onValueChange={(v) => setActive(v as MaterialSection)} className="w-full">
        <TabsList className="flex flex-wrap h-auto gap-1 bg-muted/50 p-1">
          {sectionsWithItems.map((s) => (
            <TabsTrigger key={s} value={s} className="text-xs">
              {SECTION_LABEL[s]} ({MATERIALS_BY_SECTION[s].length})
            </TabsTrigger>
          ))}
        </TabsList>
        {sectionsWithItems.map((s) => (
          <TabsContent key={s} value={s} className="mt-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {MATERIALS_BY_SECTION[s].map((item) => (
                <MaterialCard key={item.id} item={item} consultantId={consultantId} />
              ))}
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
