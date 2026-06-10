import { useState } from "react";
import { Search, Trash2, ListPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { VoiceClipRecorder } from "./VoiceClipRecorder";
import type { VoiceNameClip } from "@/hooks/useVoiceTemplates";

interface Props {
  consultantId: string;
  clips: VoiceNameClip[];
  onUpsert: (display: string, audioUrl: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export function VoiceNamesLibrary({ consultantId, clips, onUpsert, onDelete }: Props) {
  const [filter, setFilter] = useState("");
  const [singleName, setSingleName] = useState("");
  const [bulk, setBulk] = useState("");
  const [bulkQueue, setBulkQueue] = useState<string[]>([]);

  const filtered = clips.filter((c) => c.name_display.toLowerCase().includes(filter.toLowerCase()));

  const currentBulkName = bulkQueue[0] || null;

  function startBulk() {
    const list = bulk.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
    if (!list.length) return;
    setBulkQueue(list);
    setBulk("");
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs text-muted-foreground mb-2">
          Grave o nome de cada cliente interessado. Quando enviar um template de voz, o sistema chama a pessoa pelo nome usando a sua gravação.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* gravar um nome */}
          <div className="border border-border rounded-lg p-3 space-y-2 bg-card/50">
            <p className="text-xs font-semibold">Gravar um nome</p>
            <Input value={singleName} onChange={(e) => setSingleName(e.target.value)} placeholder="Ex: Ana" />
            <VoiceClipRecorder
              consultantId={consultantId}
              slug={`voz-nome-${singleName.toLowerCase() || "novo"}`}
              idleLabel={singleName ? `Gravar "${singleName}"` : "Digite o nome primeiro"}
              disabled={!singleName.trim()}
              onUploaded={async (url) => {
                await onUpsert(singleName, url);
                setSingleName("");
              }}
            />
          </div>

          {/* gravar lista */}
          <div className="border border-border rounded-lg p-3 space-y-2 bg-card/50">
            <p className="text-xs font-semibold flex items-center gap-1"><ListPlus className="w-3.5 h-3.5" /> Gravar lista (rápido)</p>
            {currentBulkName ? (
              <>
                <p className="text-xs">
                  Próximo nome: <strong className="text-primary">{currentBulkName}</strong>
                  <span className="text-muted-foreground"> ({bulkQueue.length} restando)</span>
                </p>
                <VoiceClipRecorder
                  consultantId={consultantId}
                  slug={`voz-nome-${currentBulkName.toLowerCase()}`}
                  idleLabel={`Gravar "${currentBulkName}"`}
                  onUploaded={async (url) => {
                    await onUpsert(currentBulkName, url);
                    setBulkQueue((q) => q.slice(1));
                  }}
                />
                <Button size="sm" variant="ghost" onClick={() => setBulkQueue((q) => q.slice(1))}>Pular este</Button>
              </>
            ) : (
              <>
                <Textarea rows={3} value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder="Ana, Bruno, Lucas, Maria..." />
                <Button size="sm" onClick={startBulk} disabled={!bulk.trim()}>Começar</Button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* lista */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Search className="w-4 h-4 text-muted-foreground" />
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={`Buscar entre ${clips.length} nome${clips.length === 1 ? "" : "s"}`} className="h-8" />
        </div>
        {filtered.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">Nenhum nome gravado ainda</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[320px] overflow-auto pr-1">
            {filtered.map((c) => (
              <div key={c.id} className="flex items-center gap-2 border border-border rounded p-2 bg-card/40">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold truncate">{c.name_display}</p>
                  <audio src={c.audio_url} controls className="w-full h-7 mt-1" />
                </div>
                <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => onDelete(c.id)}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
