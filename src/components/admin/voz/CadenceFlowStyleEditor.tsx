/**
 * Inspetor Multicanal — shell compacto (modelo StepInspector, visual mais leve).
 */
import { useEffect, useState, type ReactNode } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { HelpCircle, Maximize2, Minimize2 } from "lucide-react";
import { cn } from "@/lib/utils";

function TabHelp({ text }: { text: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => e.stopPropagation()}
          className="inline-flex text-muted-foreground/50 hover:text-primary"
          aria-label="Ajuda"
        >
          <HelpCircle className="h-2.5 w-2.5" />
        </span>
      </PopoverTrigger>
      <PopoverContent side="bottom" className="w-56 text-[11px] leading-snug">
        {text}
      </PopoverContent>
    </Popover>
  );
}

export type CadenceEditorTab = "conteudo" | "botoes" | "midias" | "avancado";

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  stepKey?: string;
  contentTab: ReactNode;
  buttonsTab: ReactNode;
  mediaTab: ReactNode;
  advancedTab: ReactNode;
  footer?: ReactNode;
  tab?: CadenceEditorTab;
  onTabChange?: (tab: CadenceEditorTab) => void;
  defaultTab?: CadenceEditorTab;
};

export function CadenceFlowStyleEditor({
  open,
  onClose,
  title,
  description = "Salve para publicar · prévia ao lado",
  stepKey,
  contentTab,
  buttonsTab,
  mediaTab,
  advancedTab,
  footer,
  tab: controlledTab,
  onTabChange,
  defaultTab = "conteudo",
}: Props) {
  const [fullscreen, setFullscreen] = useState(false);
  const [internalTab, setInternalTab] = useState<string>(defaultTab);
  const tab = controlledTab ?? internalTab;

  const setTab = (next: string) => {
    const t = next as CadenceEditorTab;
    if (onTabChange) onTabChange(t);
    else setInternalTab(t);
  };

  useEffect(() => {
    if (controlledTab == null) setInternalTab(defaultTab);
  }, [defaultTab, stepKey, controlledTab]);

  useEffect(() => {
    if (!open) setFullscreen(false);
  }, [open]);

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <SheetContent
        side="right"
        className={cn(
          "flex flex-col gap-0 overflow-hidden p-0 transition-[max-width] duration-200",
          fullscreen ? "w-screen sm:max-w-[100vw]" : "w-full sm:max-w-[400px]",
        )}
      >
        <div className="shrink-0 border-b border-border/60 bg-gradient-to-b from-muted/40 to-background px-4 pb-3 pt-4 pr-12">
          <SheetHeader className="space-y-0.5 text-left">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <SheetTitle className="truncate text-[15px] font-semibold leading-tight tracking-tight">
                  {title}
                </SheetTitle>
                <SheetDescription className="mt-0.5 text-[11px] leading-snug">
                  {description}
                </SheetDescription>
              </div>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7 shrink-0 text-muted-foreground"
                onClick={() => setFullscreen((v) => !v)}
                aria-label={fullscreen ? "Reduzir" : "Tela cheia"}
              >
                {fullscreen ? (
                  <Minimize2 className="h-3.5 w-3.5" />
                ) : (
                  <Maximize2 className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>
          </SheetHeader>
        </div>

        <Tabs
          value={tab}
          onValueChange={setTab}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="shrink-0 px-3 pt-2.5">
            <TabsList className="grid h-8 w-full grid-cols-4 rounded-lg bg-muted/70 p-0.5">
              {(
                [
                  ["conteudo", "Texto", "Texto da mensagem. Áudio na aba Mídia."],
                  ["botoes", "Botões", "Até 3 botões Whapi (título ≤ 25)."],
                  ["midias", "Mídia", "Cortes TTS, gerar MP3 e teste WA."],
                  ["avancado", "Mais", "Runtime, aprovação e metadados."],
                ] as const
              ).map(([value, label, help]) => (
                <TabsTrigger
                  key={value}
                  value={value}
                  className="h-7 gap-0.5 rounded-md px-1 text-[11px] data-[state=active]:shadow-sm"
                >
                  <span className="flex items-center gap-0.5">
                    {label}
                    <TabHelp text={help} />
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            <TabsContent value="conteudo" className="mt-0 space-y-3 focus-visible:outline-none">
              {contentTab}
            </TabsContent>
            <TabsContent value="botoes" className="mt-0 space-y-3 focus-visible:outline-none">
              {buttonsTab}
            </TabsContent>
            <TabsContent value="midias" className="mt-0 space-y-3 focus-visible:outline-none">
              {mediaTab}
            </TabsContent>
            <TabsContent value="avancado" className="mt-0 space-y-3 focus-visible:outline-none">
              {advancedTab}
            </TabsContent>
          </div>
        </Tabs>

        {footer && (
          <div className="shrink-0 space-y-2 border-t border-border/50 bg-muted/20 px-4 py-2.5">
            {footer}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
