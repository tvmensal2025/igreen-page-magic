import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Star, Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  customerId: string;
  /** Pré-preenche o snippet (ex: o trecho selecionado da conversa). Se vazio, edge pega últimas 8 msgs. */
  defaultSnippet?: string;
  /** Botão compacto (ícone) vs com texto */
  compact?: boolean;
}

const ETAPAS = [
  { v: "interesse", l: "Interesse / abertura" },
  { v: "valor", l: "Coleta de valor da conta" },
  { v: "simulacao", l: "Simulação / apresentação" },
  { v: "objecao", l: "Quebra de objeção" },
  { v: "foto_conta", l: "Pedido de foto da conta" },
  { v: "doc", l: "Pedido de documento" },
  { v: "email", l: "Coleta de e-mail" },
  { v: "fechamento", l: "Fechamento / finalização" },
];

export default function WinningConversationButton({ customerId, defaultSnippet, compact }: Props) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [etapa, setEtapa] = useState("fechamento");
  const [outcome, setOutcome] = useState("");
  const [snippet, setSnippet] = useState(defaultSnippet || "");
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("marcar-conversa-vencedora", {
        body: { customerId, etapa, outcome: outcome.trim() || undefined, snippet: snippet.trim() || undefined },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast({ title: "⭐ Marcada", description: "Esse trecho vai virar exemplo pra IA replicar." });
      setOpen(false);
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message || "Falha ao marcar", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {compact ? (
        <Button variant="ghost" size="icon" onClick={() => setOpen(true)} title="Marcar como exemplo vencedor">
          <Star className="h-4 w-4" />
        </Button>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <Star className="h-3.5 w-3.5 mr-1" /> Marcar vencedora
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Marcar conversa como exemplo vencedor</DialogTitle>
            <p className="text-xs text-muted-foreground">Esse trecho vira referência (few-shot) que a Vendedora v1 consulta via busca semântica em conversas futuras da mesma etapa.</p>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Etapa</Label>
              <Select value={etapa} onValueChange={setEtapa}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ETAPAS.map(e => <SelectItem key={e.v} value={e.v}>{e.l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Resultado (opcional)</Label>
              <Input value={outcome} onChange={e => setOutcome(e.target.value)} placeholder="ex: quebrou objeção 'é golpe', lead avançou pra foto" maxLength={240} />
            </div>
            <div>
              <Label className="text-xs">Trecho (deixe vazio pra pegar últimas 8 mensagens)</Label>
              <Textarea
                value={snippet}
                onChange={e => setSnippet(e.target.value)}
                rows={6}
                placeholder={`Lead: tô achando caro\nBot: entendo, é por isso que…`}
                className="font-mono text-xs"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={submit} disabled={saving}>
              {saving && <Loader2 className="h-3 w-3 animate-spin mr-1" />} Marcar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
