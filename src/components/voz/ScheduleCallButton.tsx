/**
 * Botão + diálogo reutilizável para agendar uma ligação Velip para 1 contato.
 * Regra: só áudio Sofia (clip). TTS Velip desativado.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Phone, CalendarClock } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const VOICE_SOFIA = "EJV7H2baGt5ab95tOoSG";

interface ClipRow {
  id: string;
  name: string;
  duration_sec: number | null;
  voice_id?: string | null;
}

interface Props {
  phone: string | null | undefined;
  consultantId: string;
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
  consultantId,
  contactName,
  customerId,
  triggerLabel = "Agendar ligação",
  size = "sm",
  variant = "outline",
  className,
  iconOnly,
}: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [clips, setClips] = useState<ClipRow[]>([]);
  const [clipId, setClipId] = useState<string>("");
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
      .select("id, name, duration_sec, voice_id")
      .eq("consultant_id", consultantId)
      .order("created_at", { ascending: false })
      .limit(40);
    const rows = ((data as ClipRow[]) ?? []).filter(
      (c) => !c.voice_id || c.voice_id === VOICE_SOFIA,
    );
    setClips(rows);
    if (!clipId && rows[0]) setClipId(rows[0].id);
  }, [consultantId, clipId]);

  useEffect(() => { if (open) void loadClips(); }, [open, loadClips]);

  const submit = async () => {
    if (!phone) return toast.error("Sem telefone");
    if (!consultantId) return toast.error("Sessão expirada");
    if (!clipId) return toast.error("Escolha um áudio Sofia");
    const at = new Date(when);
    if (Number.isNaN(at.getTime())) return toast.error("Data inválida");
    if (at.getTime() < Date.now() - 60_000) return toast.error("Escolha uma data futura");

    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("voice-dialer-enqueue", {
        body: {
          action: "create_campaign",
          campaign_name: `Ligação Sofia · ${contactName || phone}`,
          dispatch_kind: "audio",
          audio_clip_id: clipId,
          caller_id: callerId.trim() || undefined,
          scheduled_at: at.toISOString(),
          max_attempts: maxAttempts,
          velip_mode: "single",
          phones: [{ phone, name: contactName ?? null, customer_id: customerId ?? null }],
          config: { sofia_only: true },
        },
      });
      if (error) throw new Error(error.message);
      if ((data as any)?.error) throw new Error((data as any).message || (data as any).error);
      toast.success(`Ligação Sofia agendada para ${at.toLocaleString("pt-BR")}`);
      setOpen(false);
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
        title="Agendar ligação Sofia"
      >
        <Phone className={iconOnly ? "h-4 w-4" : "h-3.5 w-3.5"} />
        {!iconOnly && <span className="ml-1.5 text-[11px] font-semibold">{triggerLabel}</span>}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4" /> Agendar ligação Sofia
            </DialogTitle>
            <DialogDescription>
              {contactName ? `Para ${contactName} · ${phone}` : `Para ${phone}`}
              {" · "}só áudio Sofia (sem TTS genérico)
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Quando</Label>
              <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
            </div>

            <div className="space-y-1.5">
              <Label>Áudio Sofia</Label>
              <Select value={clipId} onValueChange={setClipId}>
                <SelectTrigger><SelectValue placeholder="Escolha um clipe Sofia" /></SelectTrigger>
                <SelectContent>
                  {clips.length === 0
                    ? <SelectItem value="__none" disabled>Sem clipes Sofia — gere no Estúdio</SelectItem>
                    : clips.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}{c.duration_sec ? ` · ${c.duration_sec}s` : ""}
                        </SelectItem>
                      ))}
                </SelectContent>
              </Select>
            </div>

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
            <Button onClick={() => void submit()} disabled={busy || !phone || !clipId}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CalendarClock className="h-4 w-4 mr-2" />}
              Agendar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
