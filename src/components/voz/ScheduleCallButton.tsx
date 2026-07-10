/**
 * Botão + diálogo reutilizável para agendar uma ligação Velip para 1 contato.
 * Usado no header do Chat (WhatsApp), no CaptureSheet e onde mais precisar.
 *
 * Cria uma campanha voice_campaigns em modo "single" com 1 alvo e
 * scheduled_at — o voice-dialer-cron dispara automaticamente na hora certa.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Phone, CalendarClock } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/AuthContext";

interface ClipRow { id: string; name: string; duration_sec: number | null; }

interface Props {
  phone: string | null | undefined;
  contactName?: string | null;
  customerId?: string | null;
  triggerLabel?: string;
  size?: ButtonProps["size"];
  variant?: ButtonProps["variant"];
  className?: string;
  iconOnly?: boolean;
}

function toLocalDatetimeValue(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function ScheduleCallButton({
  phone,
  contactName,
  customerId,
  triggerLabel = "Agendar ligação",
  size = "sm",
  variant = "outline",
  className,
  iconOnly,
}: Props) {
  const { consultant } = useAuth();
  const consultantId = consultant?.id;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"audio" | "tts">("tts");
  const [clips, setClips] = useState<ClipRow[]>([]);
  const [clipId, setClipId] = useState<string>("");
  const [ttsText, setTtsText] = useState("");
  const [callerId, setCallerId] = useState("");
  const [maxAttempts, setMaxAttempts] = useState(2);
  const defaultAt = useMemo(() => {
    const d = new Date(Date.now() + 15 * 60_000);
    d.setSeconds(0, 0);
    return toLocalDatetimeValue(d);
  }, [open]);
  const [when, setWhen] = useState<string>(defaultAt);

  useEffect(() => { setWhen(defaultAt); }, [defaultAt]);

  const loadClips = useCallback(async () => {
    if (!consultantId) return;
    const { data } = await (supabase as any)
      .from("voice_audio_clips")
      .select("id, name, duration_sec")
      .eq("consultant_id", consultantId)
      .order("created_at", { ascending: false })
      .limit(30);
    const rows = (data as ClipRow[]) ?? [];
    setClips(rows);
    if (!clipId && rows[0]) setClipId(rows[0].id);
  }, [consultantId, clipId]);

  useEffect(() => { if (open) void loadClips(); }, [open, loadClips]);

  const submit = async () => {
    if (!phone) return toast.error("Sem telefone");
    if (!consultantId) return toast.error("Sessão expirada");
    if (mode === "audio" && !clipId) return toast.error("Escolha um áudio");
    if (mode === "tts" && !ttsText.trim()) return toast.error("Digite a mensagem");
    const at = new Date(when);
    if (Number.isNaN(at.getTime())) return toast.error("Data inválida");
    if (at.getTime() < Date.now() - 60_000) return toast.error("Escolha uma data futura");

    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("voice-dialer-enqueue", {
        body: {
          action: "create_campaign",
          campaign_name: `Ligação agendada · ${contactName || phone}`,
          dispatch_kind: mode,
          audio_clip_id: mode === "audio" ? clipId : null,
          tts_text: mode === "tts" ? ttsText.trim() : undefined,
          caller_id: callerId.trim() || undefined,
          scheduled_at: at.toISOString(),
          max_attempts: maxAttempts,
          velip_mode: "single",
          phones: [{ phone, name: contactName ?? null, customer_id: customerId ?? null }],
        },
      });
      if (error) throw new Error(error.message);
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success(`Ligação agendada para ${at.toLocaleString("pt-BR")}`);
      setOpen(false);
      setTtsText("");
    } catch (e) {
      toast.error((e as Error).message || "Falha ao agendar");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        size={size}
        variant={variant}
        className={className}
        onClick={() => setOpen(true)}
        disabled={!phone}
        title="Agendar ligação Velip"
      >
        <Phone className="h-3.5 w-3.5" />
        {!iconOnly && <span className="ml-1.5 text-[11px] font-semibold">{triggerLabel}</span>}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4" /> Agendar ligação
            </DialogTitle>
            <DialogDescription>
              {contactName ? `Para ${contactName} · ${phone}` : `Para ${phone}`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Quando</Label>
              <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
            </div>

            <Tabs value={mode} onValueChange={(v) => setMode(v as "audio" | "tts")}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="tts">Voz sintetizada</TabsTrigger>
                <TabsTrigger value="audio">Áudio gravado</TabsTrigger>
              </TabsList>
              <TabsContent value="tts" className="pt-3 space-y-1.5">
                <Label>Mensagem</Label>
                <Textarea
                  rows={4}
                  maxLength={400}
                  value={ttsText}
                  onChange={(e) => setTtsText(e.target.value)}
                  placeholder="Olá, aqui é da equipe iGreen. Passando para lembrar do seu cadastro..."
                />
                <p className="text-[10px] text-muted-foreground">{ttsText.length}/400 caracteres</p>
              </TabsContent>
              <TabsContent value="audio" className="pt-3 space-y-1.5">
                <Label>Clipe</Label>
                <Select value={clipId} onValueChange={setClipId}>
                  <SelectTrigger><SelectValue placeholder="Escolha um clipe" /></SelectTrigger>
                  <SelectContent>
                    {clips.length === 0
                      ? <SelectItem value="__none" disabled>Sem clipes — grave um em Admin → Ligação</SelectItem>
                      : clips.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}{c.duration_sec ? ` · ${c.duration_sec}s` : ""}
                          </SelectItem>
                        ))}
                  </SelectContent>
                </Select>
              </TabsContent>
            </Tabs>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>BINA (opcional)</Label>
                <Input placeholder="551199..." value={callerId} onChange={(e) => setCallerId(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Tentativas</Label>
                <Select value={String(maxAttempts)} onValueChange={(v) => setMaxAttempts(Number(v))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 5].map((n) => <SelectItem key={n} value={String(n)}>{n}x</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancelar</Button>
            <Button onClick={() => void submit()} disabled={busy || !phone}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CalendarClock className="h-4 w-4 mr-2" />}
              Agendar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
