import { useState } from "react";
import { Mic2, Plus, Trash2, Edit3, ChevronDown, ChevronRight, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useVoiceTemplates } from "@/hooks/useVoiceTemplates";
import { VoiceTemplateEditor } from "./VoiceTemplateEditor";
import { VoiceNamesLibrary } from "./VoiceNamesLibrary";
import { useConfirm } from "@/components/ui/confirm-dialog";

interface Props { consultantId: string; }

export function VoiceTemplatesPanel({ consultantId }: Props) {
  const vt = useVoiceTemplates(consultantId);
  const confirm = useConfirm();
  const [newName, setNewName] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  async function createNew() {
    if (!newName.trim()) return;
    const created = await vt.createTemplate(newName);
    setNewName("");
    if (created) setOpenId(created.id);
  }

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-card via-card to-primary/10">
      <div className="absolute -top-20 -right-20 w-40 h-40 bg-primary/5 rounded-full blur-3xl" />
      <div className="relative p-5 sm:p-7">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/20 to-primary/10 flex items-center justify-center border border-primary/20">
            <Mic2 className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h3 className="font-heading font-bold text-foreground text-lg">Templates de Voz</h3>
            <p className="text-xs text-muted-foreground">Áudios costurados na hora chamando o cliente interessado pelo nome</p>
          </div>
        </div>

        <Tabs defaultValue="templates">
          <TabsList className="mb-4">
            <TabsTrigger value="templates"><Mic2 className="w-3.5 h-3.5 mr-1" /> Templates</TabsTrigger>
            <TabsTrigger value="names"><Users className="w-3.5 h-3.5 mr-1" /> Biblioteca de nomes ({vt.clips.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="templates" className="space-y-3">
            {vt.loading ? (
              <p className="text-sm text-muted-foreground text-center py-4">Carregando…</p>
            ) : vt.templates.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">Nenhum template de voz ainda</p>
            ) : (
              <div className="space-y-2">
                {vt.templates.map((t) => {
                  const open = openId === t.id;
                  return (
                    <div key={t.id} className="border border-border rounded-lg bg-card/40">
                      <button
                        onClick={() => setOpenId(open ? null : t.id)}
                        className="w-full flex items-center gap-2 p-3 text-left hover:bg-accent/40"
                      >
                        {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        <Mic2 className="w-4 h-4 text-primary" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold truncate">{t.name}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {t.blocks?.length || 0} bloco{(t.blocks?.length || 0) === 1 ? "" : "s"}
                            {t.shortcut && <span className="ml-2 font-mono text-primary">{t.shortcut}</span>}
                          </p>
                        </div>
                        <Edit3 className="w-3.5 h-3.5 text-muted-foreground" />
                        <Button
                          size="icon" variant="ghost" className="h-7 w-7 text-destructive"
                          onClick={async (e) => {
                            e.stopPropagation();
                            const ok = await confirm({ title: `Apagar template "${t.name}"?`, confirmText: "Apagar", tone: "danger" });
                            if (ok) vt.deleteTemplate(t.id);
                          }}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </button>

                      {open && (
                        <div className="p-3 pt-0">
                          <VoiceTemplateEditor
                            consultantId={consultantId}
                            template={t}
                            clips={vt.clips}
                            onUpdate={vt.updateTemplate}
                            onAddBlock={vt.addBlock}
                            onUpdateBlockAudio={vt.updateBlockAudio}
                            onUpdateBlockVariableKey={vt.updateBlockVariableKey}
                            onDeleteBlock={vt.deleteBlock}
                            onMoveBlock={vt.moveBlock}
                            onRender={vt.renderTemplate}
                            onUpsertNameClip={vt.upsertNameClip}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex gap-2 pt-2 border-t border-border">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Nome do novo template (ex: Boas-vindas)"
                onKeyDown={(e) => { if (e.key === "Enter") createNew(); }}
              />
              <Button onClick={createNew} disabled={!newName.trim()}>
                <Plus className="w-4 h-4 mr-1" /> Criar
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="names">
            <VoiceNamesLibrary
              consultantId={consultantId}
              clips={vt.clips}
              onUpsert={vt.upsertNameClip}
              onDelete={vt.deleteNameClip}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
