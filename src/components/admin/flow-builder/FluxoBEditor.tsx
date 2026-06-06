import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, Send, MessageSquare } from "lucide-react";

interface Props {
  consultantId: string;
}

interface ChatMsg { role: "user" | "assistant"; text: string; meta?: any }

export default function FluxoBEditor({ consultantId }: Props) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [temperature, setTemperature] = useState(0.7);
  const [cascadeEnabled, setCascadeEnabled] = useState(true);

  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  // Estado sintético do "lead simulado" — acumula updates entre turnos no tester
  const [simState, setSimState] = useState<Record<string, any>>({});

  useEffect(() => {
    if (!consultantId) return;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("consultants")
        .select("ai_persona_fluxo_b, ai_persona_fluxo_b_temperature, ai_persona_fluxo_b_cascade_enabled")
        .eq("id", consultantId)
        .maybeSingle();
      if (error) {
        toast({ title: "Erro carregando prompt", description: error.message, variant: "destructive" });
      } else if (data) {
        const d = data as any;
        setPrompt(d.ai_persona_fluxo_b || "");
        setTemperature(typeof d.ai_persona_fluxo_b_temperature === "number" ? d.ai_persona_fluxo_b_temperature : 0.7);
        setCascadeEnabled(d.ai_persona_fluxo_b_cascade_enabled !== false);
      }
      setLoading(false);
    })();
  }, [consultantId, toast]);

  async function save() {
    setSaving(true);
    const { error } = await supabase
      .from("consultants")
      .update({
        ai_persona_fluxo_b: prompt,
        ai_persona_fluxo_b_temperature: temperature,
        ai_persona_fluxo_b_cascade_enabled: cascadeEnabled,
      } as any)
      .eq("id", consultantId);
    setSaving(false);
    if (error) toast({ title: "Erro salvando", description: error.message, variant: "destructive" });
    else toast({ title: "Salvo ✓", description: "Super prompt atualizado." });
  }

  async function sendTest() {
    if (!input.trim() || !consultantId) return;
    setSending(true);
    const userMsg: ChatMsg = { role: "user", text: input };
    const newChat = [...chat, userMsg];
    setChat(newChat);
    setInput("");
    try {
      const history = newChat.slice(0, -1).map(m => ({ role: m.role, content: m.text }));
      const { data, error } = await supabase.functions.invoke("fluxo-b-ai", {
        body: { consultantId, inboundText: userMsg.text, dryRun: true, customerState: simState, history },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (data?.customerUpdates && typeof data.customerUpdates === "object") {
        setSimState(prev => ({ ...prev, ...data.customerUpdates }));
      }
      setChat(prev => [...prev, { role: "assistant", text: data.reply, meta: { model: data.modelUsed, tools: data.toolsApplied, step: data.conversationStepUpdate, latency: data.latencyMs, variantId: data.variantId, debug: data.debug } }]);
    } catch (e) {
      setChat(prev => [...prev, { role: "assistant", text: `❌ erro: ${(e as Error).message}` }]);
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="animate-spin" /></div>;
  }

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Super Prompt (Fluxo B — IA Livre)</CardTitle>
          <p className="text-xs text-muted-foreground">A IA conversa do início ao fim. Use {`{{representante}}`}, {`{{nome_cliente}}`}, {`{{valor_conta}}`} pra variáveis dinâmicas.</p>
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
            <Label>Criatividade (temperature): {temperature.toFixed(2)}</Label>
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

          <Button onClick={save} disabled={saving} className="w-full">
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
          <p className="text-[11px] text-muted-foreground">Lead simulado · contexto vazio (sem nome, sem valor de conta). Use pra validar o tom e o roteiro da IA.</p>

          <div className="border rounded-lg p-3 h-96 overflow-y-auto bg-muted/30 space-y-2">
            {chat.length === 0 && <p className="text-xs text-muted-foreground text-center py-12">Nenhuma mensagem ainda. Digite abaixo para começar.</p>}
            {chat.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${m.role === "user" ? "bg-primary text-primary-foreground" : "bg-card border"}`}>
                  <p className="whitespace-pre-wrap">{m.text}</p>
                  {m.meta && (
                    <>
                      <p className="text-[10px] opacity-60 mt-1">
                        {m.meta.model} · {m.meta.latency}ms
                        {m.meta.variantId ? ` · ${m.meta.variantId}` : ""}
                        {m.meta.tools?.length ? ` · tools: ${m.meta.tools.join(",")}` : ""}
                        {m.meta.step ? ` · step→${m.meta.step}` : ""}
                      </p>
                      {m.meta.debug && (
                        <details className="mt-2 text-[10px] opacity-80">
                          <summary className="cursor-pointer underline">Decisão interna (v1)</summary>
                          <div className="mt-1 space-y-1 font-mono">
                            <div>perfil: <b>{m.meta.debug.perfil?.perfil}</b> · sent: {m.meta.debug.perfil?.sentimento} · temp: {m.meta.debug.perfil?.temperatura}</div>
                            <div>etapa: <b>{m.meta.debug.plano?.etapa_atual}</b> · jogada: {m.meta.debug.plano?.proxima_jogada} · tom: {m.meta.debug.plano?.tom}</div>
                            <div>capturar: {(m.meta.debug.plano?.info_a_capturar || []).join(", ") || "-"}</div>
                            <div>RAG: {m.meta.debug.ragChunks} chunks · crítico: {m.meta.debug.criticoAprovado ? "✓" : `✗ (${(m.meta.debug.criticoProblemas || []).join(",")})`}</div>
                            {m.meta.debug.checklist && (
                              <div>checklist: {m.meta.debug.checklist.pronto ? "✓ pronto" : `falta ${(m.meta.debug.checklist.faltantes || []).map((f: any) => f.campo).join(", ")}`}</div>
                            )}
                            {m.meta.debug.closer && (
                              <div>closer: {m.meta.debug.closer.acionou ? (m.meta.debug.closer.ok ? `✓ ${m.meta.debug.closer.mode}` : `✗ ${m.meta.debug.closer.erro || (m.meta.debug.closer.portalMissing || []).join(", ")}`) : "não acionou"}</div>
                            )}
                          </div>
                        </details>
                      )}
                    </>
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
              disabled={sending}
            />
            <Button onClick={sendTest} disabled={!input.trim() || sending}>
              <Send className="w-4 h-4" />
            </Button>
          </div>
          <Button variant="ghost" size="sm" onClick={() => { setChat([]); setSimState({}); }} disabled={chat.length === 0}>Limpar chat</Button>
        </CardContent>
      </Card>
    </div>
  );
}
