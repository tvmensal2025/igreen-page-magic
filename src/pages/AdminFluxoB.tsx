import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, Sparkles, Send, ArrowLeft, MessageSquare } from "lucide-react";

interface Consultant {
  id: string;
  name: string;
  ai_persona_fluxo_b: string | null;
  ai_persona_fluxo_b_temperature: number | null;
  ai_persona_fluxo_b_cascade_enabled: boolean | null;
}

interface ChatMsg { role: "user" | "assistant"; text: string; meta?: any }

export default function AdminFluxoB() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [consultants, setConsultants] = useState<Consultant[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [prompt, setPrompt] = useState("");
  const [temperature, setTemperature] = useState(0.7);
  const [cascadeEnabled, setCascadeEnabled] = useState(true);

  // Tester
  const [testCustomerId, setTestCustomerId] = useState("");
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("consultants")
        .select("id, name, ai_persona_fluxo_b, ai_persona_fluxo_b_temperature, ai_persona_fluxo_b_cascade_enabled")
        .order("name");
      if (error) {
        toast({ title: "Erro carregando consultores", description: error.message, variant: "destructive" });
      } else if (data) {
        setConsultants(data as Consultant[]);
        if (data.length > 0) selectConsultant(data[0] as Consultant);
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function selectConsultant(c: Consultant) {
    setSelectedId(c.id);
    setPrompt(c.ai_persona_fluxo_b || "");
    setTemperature(typeof c.ai_persona_fluxo_b_temperature === "number" ? c.ai_persona_fluxo_b_temperature : 0.7);
    setCascadeEnabled(c.ai_persona_fluxo_b_cascade_enabled !== false);
  }

  async function save() {
    if (!selectedId) return;
    setSaving(true);
    const { error } = await supabase
      .from("consultants")
      .update({
        ai_persona_fluxo_b: prompt,
        ai_persona_fluxo_b_temperature: temperature,
        ai_persona_fluxo_b_cascade_enabled: cascadeEnabled,
      })
      .eq("id", selectedId);
    setSaving(false);
    if (error) {
      toast({ title: "Erro salvando", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Salvo ✓", description: "Super prompt atualizado." });
      // atualiza lista
      setConsultants(prev => prev.map(c => c.id === selectedId
        ? { ...c, ai_persona_fluxo_b: prompt, ai_persona_fluxo_b_temperature: temperature, ai_persona_fluxo_b_cascade_enabled: cascadeEnabled }
        : c));
    }
  }

  async function sendTest() {
    if (!testCustomerId.trim() || !input.trim()) return;
    setSending(true);
    const userMsg: ChatMsg = { role: "user", text: input };
    setChat(prev => [...prev, userMsg]);
    setInput("");
    try {
      const { data, error } = await supabase.functions.invoke("fluxo-b-ai", {
        body: { customerId: testCustomerId.trim(), inboundText: userMsg.text, dryRun: true },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setChat(prev => [...prev, { role: "assistant", text: data.reply, meta: { model: data.modelUsed, tools: data.toolsApplied, step: data.conversationStepUpdate, latency: data.latencyMs } }]);
    } catch (e) {
      setChat(prev => [...prev, { role: "assistant", text: `❌ erro: ${(e as Error).message}` }]);
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-screen"><Loader2 className="animate-spin" /></div>;
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <Link to="/admin"><Button variant="ghost" size="sm"><ArrowLeft className="w-4 h-4 mr-2" />Admin</Button></Link>
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2"><Sparkles className="w-7 h-7 text-primary" />Fluxo B — IA Livre</h1>
            <p className="text-sm text-muted-foreground">A IA conversa do início ao fim usando um super prompt editável. Captura de mídia (conta/documento) continua determinística.</p>
          </div>
        </div>

        <Card>
          <CardHeader><CardTitle>Consultor</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {consultants.map(c => (
                <Button
                  key={c.id}
                  variant={c.id === selectedId ? "default" : "outline"}
                  size="sm"
                  onClick={() => selectConsultant(c)}
                >
                  {c.name}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="grid lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Super Prompt</CardTitle>
              <p className="text-xs text-muted-foreground">Use {`{{representante}}`}, {`{{nome_cliente}}`}, {`{{valor_conta}}`} para variáveis dinâmicas.</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <Textarea
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                rows={20}
                className="font-mono text-xs"
                placeholder="Persona, objetivo, tom, regras..."
              />

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Criatividade (temperature): {temperature.toFixed(2)}</Label>
                </div>
                <Slider value={[temperature]} min={0} max={1} step={0.05} onValueChange={v => setTemperature(v[0])} />
                <p className="text-xs text-muted-foreground">0 = previsível, 1 = criativo. Default 0.7.</p>
              </div>

              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <Label className="text-sm">Cascata GPT-5.5</Label>
                  <p className="text-xs text-muted-foreground">Se Gemini Flash falhar/recusar, tenta GPT-5.5.</p>
                </div>
                <Switch checked={cascadeEnabled} onCheckedChange={setCascadeEnabled} />
              </div>

              <Button onClick={save} disabled={saving || !selectedId} className="w-full">
                {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Salvar super prompt
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><MessageSquare className="w-5 h-5" />Testar (lead simulado)</CardTitle>
              <p className="text-xs text-muted-foreground">Conversa com a IA usando o prompt salvo, SEM persistir nada nem enviar WhatsApp.</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="text-xs">Customer ID (UUID de um lead real para usar como contexto)</Label>
                <Input
                  value={testCustomerId}
                  onChange={e => setTestCustomerId(e.target.value)}
                  placeholder="ex.: 2b8caea7-fa9b-432f-bdf2-c74167095836"
                  className="font-mono text-xs"
                />
              </div>

              <div className="border rounded-lg p-3 h-96 overflow-y-auto bg-muted/30 space-y-2">
                {chat.length === 0 && <p className="text-xs text-muted-foreground text-center py-12">Nenhuma mensagem ainda. Digite abaixo para começar.</p>}
                {chat.map((m, i) => (
                  <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${m.role === "user" ? "bg-primary text-primary-foreground" : "bg-card border"}`}>
                      <p className="whitespace-pre-wrap">{m.text}</p>
                      {m.meta && (
                        <p className="text-[10px] opacity-60 mt-1">
                          {m.meta.model} · {m.meta.latency}ms
                          {m.meta.tools?.length ? ` · tools: ${m.meta.tools.join(",")}` : ""}
                          {m.meta.step ? ` · step→${m.meta.step}` : ""}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
                {sending && <div className="flex justify-start"><div className="bg-card border rounded-lg px-3 py-2"><Loader2 className="w-3 h-3 animate-spin" /></div></div>}
              </div>

              <div className="flex gap-2">
                <Input
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendTest(); } }}
                  placeholder="Digite como se fosse o lead..."
                  disabled={!testCustomerId.trim() || sending}
                />
                <Button onClick={sendTest} disabled={!testCustomerId.trim() || !input.trim() || sending}>
                  <Send className="w-4 h-4" />
                </Button>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setChat([])} disabled={chat.length === 0}>Limpar chat</Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
