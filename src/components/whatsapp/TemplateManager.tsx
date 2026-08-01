import { useState, useMemo } from "react";
import { Wand2, Mic2, Globe2, User, Plus } from "lucide-react";
import type { MessageTemplate, TemplateItem } from "@/types/whatsapp";
import { TemplateCreateForm } from "./templates/TemplateCreateForm";
import { TemplateListItem } from "./templates/TemplateListItem";
import { TemplatePreviewDialog } from "./templates/TemplatePreviewDialog";
import { VoiceTemplatesPanel } from "./voice/VoiceTemplatesPanel";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";

interface TemplateManagerProps {
  templates: MessageTemplate[];
  isLoading: boolean;
  consultantId: string;
  onCreateTemplate: (name: string, content: string, mediaType?: string, mediaUrl?: string | null, imageUrl?: string | null, isPublic?: boolean, items?: TemplateItem[]) => Promise<void>;
  onUpdateTemplate: (id: string, updates: { name?: string; image_url?: string | null; content?: string; media_url?: string | null; media_type?: string; is_quick_reply?: boolean; is_public?: boolean }, items?: TemplateItem[]) => Promise<void>;
  onDeleteTemplate: (id: string) => Promise<void>;
  onRefetch?: () => Promise<void> | void;
}

export function TemplateManager({
  templates,
  isLoading,
  consultantId,
  onCreateTemplate,
  onUpdateTemplate,
  onDeleteTemplate,
  onRefetch,
}: TemplateManagerProps) {
  const [previewTemplate, setPreviewTemplate] = useState<MessageTemplate | null>(null);
  const [scope, setScope] = useState<"publicos" | "meus">("publicos");
  const [showCreate, setShowCreate] = useState(false);

  const ownedOriginIds = new Set(
    templates.filter((t) => t.consultant_id === consultantId && t.origin_template_id).map((t) => t.origin_template_id!),
  );
  const visibleTemplates = templates.filter((t) => !ownedOriginIds.has(t.id));

  const { publicos, meus } = useMemo(() => {
    const meus: MessageTemplate[] = [];
    const publicos: MessageTemplate[] = [];
    for (const t of visibleTemplates) {
      if (t.consultant_id === consultantId) meus.push(t);
      else publicos.push(t);
    }
    return { publicos, meus };
  }, [visibleTemplates, consultantId]);

  const currentList = scope === "publicos" ? publicos : meus;

  return (
    <div className="space-y-4">
      <Tabs defaultValue="text">
        <TabsList>
          <TabsTrigger value="text"><Wand2 className="w-3.5 h-3.5 mr-1" /> Templates</TabsTrigger>
          <TabsTrigger value="voice"><Mic2 className="w-3.5 h-3.5 mr-1" /> Voz personalizada</TabsTrigger>
        </TabsList>

        <TabsContent value="text">
          <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-card via-card to-primary/10">
            <div className="absolute -top-20 -right-20 w-40 h-40 bg-primary/3 rounded-full blur-3xl" />
            <div className="relative p-5 sm:p-7">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/20 to-primary/10 flex items-center justify-center border border-primary/20">
                  <Wand2 className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <h3 className="font-heading font-bold text-foreground text-lg">Templates</h3>
                    {/* Ajuda fica no topo (GuideEntry) + FAB — evita segundo ? nesta tela */}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Use os modelos públicos da plataforma ou crie os seus com sua voz, vídeo e imagem.
                  </p>
                </div>
              </div>

              {/* Toggle Públicos / Meus lado a lado */}
              <div className="grid grid-cols-2 gap-2 mb-4 p-1 rounded-xl bg-muted/40 border border-border">
                <button
                  type="button"
                  onClick={() => { setScope("publicos"); setShowCreate(false); }}
                  data-tour="wa-templates-publicos"
                  data-state={scope === "publicos" ? "active" : "inactive"}
                  aria-pressed={scope === "publicos"}
                  className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                    scope === "publicos"
                      ? "bg-primary/15 text-primary border border-primary/30 shadow-sm"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                  }`}
                >
                  <Globe2 className="w-4 h-4" />
                  <span>Públicos</span>
                  <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">{publicos.length}</Badge>
                </button>
                <button
                  type="button"
                  onClick={() => setScope("meus")}
                  data-tour="wa-templates-meus"
                  data-state={scope === "meus" ? "active" : "inactive"}
                  aria-pressed={scope === "meus"}
                  className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                    scope === "meus"
                      ? "bg-primary/15 text-primary border border-primary/30 shadow-sm"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                  }`}
                >
                  <User className="w-4 h-4" />
                  <span>Meus templates</span>
                  <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">{meus.length}</Badge>
                </button>
              </div>

              <p className="text-[11px] text-muted-foreground mb-4 px-1">
                {scope === "publicos"
                  ? "Modelos prontos da plataforma. Você pode personalizar antes de enviar."
                  : "Seus modelos pessoais — use sua própria voz, vídeo ou imagem."}
              </p>

              {isLoading ? (
                <p className="text-sm text-muted-foreground text-center py-6">Carregando...</p>
              ) : currentList.length === 0 ? (
                <div className="text-center py-8 px-4 rounded-xl border border-dashed border-border bg-muted/20">
                  <p className="text-sm text-muted-foreground mb-2">
                    {scope === "publicos"
                      ? "Nenhum template público disponível."
                      : "Você ainda não criou nenhum template."}
                  </p>
                  {scope === "meus" && (
                    <p className="text-xs text-muted-foreground/70">
                      Clique em <span className="font-medium text-primary">+ Criar meu template</span> abaixo para começar.
                    </p>
                  )}
                </div>
              ) : (
                <div className="space-y-2 mb-5">
                  {currentList.map((t) => (
                    <TemplateListItem
                      key={t.id}
                      template={t}
                      consultantId={consultantId}
                      onUpdateTemplate={onUpdateTemplate}
                      onDeleteTemplate={onDeleteTemplate}
                      onPreview={setPreviewTemplate}
                      onForked={onRefetch}
                    />
                  ))}
                </div>
              )}

              {scope === "meus" && (
                <Button
                  type="button"
                  onClick={() => setShowCreate(true)}
                  data-tour="wa-criar-template"
                  className="w-full gap-2 bg-gradient-to-r from-primary to-primary hover:from-primary hover:to-primary text-white border-0"
                >
                  <Plus className="w-4 h-4" />
                  Criar meu template
                </Button>
              )}
            </div>
            <TemplatePreviewDialog template={previewTemplate} onClose={() => setPreviewTemplate(null)} />

            {/* Modal de criação — mesmo padrão do CRM (Dialog) */}
            <Dialog open={showCreate} onOpenChange={setShowCreate}>
              <DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Plus className="w-4 h-4 text-primary" /> Novo template
                  </DialogTitle>
                  <DialogDescription>
                    Crie um modelo de mensagem com texto, áudio, imagem ou vídeo. Você escolhe se fica público ou privado.
                  </DialogDescription>
                </DialogHeader>
                <TemplateCreateForm
                  onCreateTemplate={async (...args) => {
                    await onCreateTemplate(...args);
                    setShowCreate(false);
                  }}
                />
              </DialogContent>
            </Dialog>
          </div>
        </TabsContent>

        <TabsContent value="voice">
          <VoiceTemplatesPanel consultantId={consultantId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
