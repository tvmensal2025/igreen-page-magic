import { useMemo, useState } from "react";
import { Globe, User, Mic2, Search, FileText, Image as ImageIcon, Video, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useTemplates } from "@/hooks/useTemplates";
import { useVoiceTemplates } from "@/hooks/useVoiceTemplates";

export interface PickedTemplate {
  message_type: "text" | "image" | "video" | "audio";
  message_text: string;
  media_url: string;
  image_url: string;
  voice_template_id?: string | null;
  voice_template_name?: string | null;
}

interface Props {
  consultantId: string;
  onPick: (tpl: PickedTemplate) => void;
  trigger?: React.ReactNode;
}

function typeIcon(t: string) {
  if (t === "image") return ImageIcon;
  if (t === "video") return Video;
  if (t === "audio") return Mic2;
  return FileText;
}

export function TemplatePickerPopover({ consultantId, onPick, trigger }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const { templates, isLoading } = useTemplates(consultantId);
  const { templates: voiceTemplates, loading: loadingVoice } = useVoiceTemplates(consultantId);

  const q = search.trim().toLowerCase();
  const filterByName = <T extends { name: string }>(arr: T[]) =>
    !q ? arr : arr.filter((t) => t.name.toLowerCase().includes(q));

  const publicTemplates = useMemo(
    () => filterByName(templates.filter((t: any) => t.is_public)),
    [templates, q]
  );
  const myTextTemplates = useMemo(
    () => filterByName(templates.filter((t: any) => !t.is_public && t.consultant_id === consultantId)),
    [templates, q, consultantId]
  );
  const myVoiceTemplates = useMemo(() => filterByName(voiceTemplates), [voiceTemplates, q]);

  function pickMessageTemplate(t: any) {
    const mtype = (t.media_type || "text") as PickedTemplate["message_type"];
    onPick({
      message_type: mtype === "text" || mtype === "image" || mtype === "video" || mtype === "audio" ? mtype : "text",
      message_text: t.content || "",
      media_url: t.media_url || "",
      image_url: t.image_url || "",
    });
    setOpen(false);
  }

  function pickVoiceTemplate(t: any) {
    onPick({
      message_type: "audio",
      message_text: "",
      media_url: "",
      image_url: "",
      voice_template_id: t.id,
      voice_template_name: t.name,
    });
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm" className="gap-2">
            <FileText className="h-4 w-4" />
            Usar template salvo
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-[420px] p-0" align="start">
        <Tabs defaultValue="public">
          <div className="p-3 border-b border-border">
            <TabsList className="w-full grid grid-cols-2">
              <TabsTrigger value="public" className="gap-1.5">
                <Globe className="h-3.5 w-3.5" /> Públicos
              </TabsTrigger>
              <TabsTrigger value="mine" className="gap-1.5">
                <User className="h-3.5 w-3.5" /> Meus templates
              </TabsTrigger>
            </TabsList>
            <div className="relative mt-2">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar template..."
                className="h-8 pl-7 text-xs"
              />
            </div>
          </div>

          <TabsContent value="public" className="m-0">
            <p className="px-3 pt-2 text-[10px] text-muted-foreground">
              🌐 Templates da plataforma — disponíveis para todos os consultores
            </p>
            <ScrollArea className="h-[280px]">
              <div className="p-2 space-y-1">
                {isLoading && <p className="text-xs text-muted-foreground p-2">Carregando…</p>}
                {!isLoading && publicTemplates.length === 0 && (
                  <p className="text-xs text-muted-foreground p-3 text-center">Nenhum template público {q && "encontrado"}</p>
                )}
                {publicTemplates.map((t: any) => {
                  const Icon = typeIcon(t.media_type);
                  return (
                    <button
                      key={t.id}
                      onClick={() => pickMessageTemplate(t)}
                      className="w-full text-left p-2 rounded-md hover:bg-accent transition-colors flex gap-2 items-start"
                    >
                      <div className="mt-0.5 h-7 w-7 rounded bg-primary/10 flex items-center justify-center shrink-0">
                        <Icon className="h-3.5 w-3.5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold truncate">{t.name}</p>
                        {t.content && (
                          <p className="text-[10px] text-muted-foreground line-clamp-2">{t.content}</p>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="mine" className="m-0">
            <p className="px-3 pt-2 text-[10px] text-muted-foreground">
              👤 Templates que você criou e áudios que você gravou
            </p>
            <ScrollArea className="h-[280px]">
              <div className="p-2 space-y-1">
                {(isLoading || loadingVoice) && <p className="text-xs text-muted-foreground p-2">Carregando…</p>}

                {myVoiceTemplates.length > 0 && (
                  <div className="px-1 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">Áudios (voz)</div>
                )}
                {myVoiceTemplates.map((t: any) => (
                  <button
                    key={t.id}
                    onClick={() => pickVoiceTemplate(t)}
                    className="w-full text-left p-2 rounded-md hover:bg-accent transition-colors flex gap-2 items-start"
                  >
                    <div className="mt-0.5 h-7 w-7 rounded bg-emerald-500/15 flex items-center justify-center shrink-0">
                      <Mic2 className="h-3.5 w-3.5 text-emerald-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold truncate">{t.name}</p>
                      <p className="text-[10px] text-muted-foreground">
                        Voz · {t.blocks?.length || 0} bloco{(t.blocks?.length || 0) === 1 ? "" : "s"} · costurado com nome do lead
                      </p>
                    </div>
                    <Badge variant="outline" className="text-[8px]">áudio</Badge>
                  </button>
                ))}

                {myTextTemplates.length > 0 && (
                  <div className="px-1 py-0.5 mt-2 text-[9px] uppercase tracking-wide text-muted-foreground">Textos e mídias</div>
                )}
                {myTextTemplates.map((t: any) => {
                  const Icon = typeIcon(t.media_type);
                  return (
                    <button
                      key={t.id}
                      onClick={() => pickMessageTemplate(t)}
                      className="w-full text-left p-2 rounded-md hover:bg-accent transition-colors flex gap-2 items-start"
                    >
                      <div className="mt-0.5 h-7 w-7 rounded bg-primary/10 flex items-center justify-center shrink-0">
                        <Icon className="h-3.5 w-3.5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold truncate">{t.name}</p>
                        {t.content && (
                          <p className="text-[10px] text-muted-foreground line-clamp-2">{t.content}</p>
                        )}
                      </div>
                    </button>
                  );
                })}

                {!isLoading && !loadingVoice && myTextTemplates.length === 0 && myVoiceTemplates.length === 0 && (
                  <p className="text-xs text-muted-foreground p-3 text-center">
                    Você ainda não criou templates. Vá em <strong>Templates</strong> ou <strong>Templates de Voz</strong> para criar.
                  </p>
                )}
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </PopoverContent>
    </Popover>
  );
}
