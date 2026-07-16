/**
 * Kit do Ciclo — textos/áudios/SMS do daily-reheat.
 * Grava em daily_reheat_kit. NÃO liga o motor (toggle continua OFF).
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { uploadMedia } from "@/services/minioUpload";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, RefreshCw, Save, Upload } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type KitRow = {
  consultant_id: string;
  wa_open_text: string | null;
  wa_audio_mon_url: string | null;
  wa_audio_tue_url: string | null;
  wa_audio_wed_url: string | null;
  wa_audio_thu_url: string | null;
  wa_audio_fri_url: string | null;
  wa_audio_sat_url: string | null;
  voice_audio_clip_id: string | null;
  call_tts_fallback: string | null;
  sms_na_text: string | null;
  sms_retry_text: string | null;
  bina_notes: string | null;
};

type Clip = { id: string; name: string; velip_audio_id: string | null };

const WEEKDAY_FIELDS = [
  { key: "wa_audio_mon_url", label: "Segunda" },
  { key: "wa_audio_tue_url", label: "Terça" },
  { key: "wa_audio_wed_url", label: "Quarta" },
  { key: "wa_audio_thu_url", label: "Quinta" },
  { key: "wa_audio_fri_url", label: "Sexta" },
  { key: "wa_audio_sat_url", label: "Sábado" },
] as const;

type WeekdayKey = (typeof WEEKDAY_FIELDS)[number]["key"];

const EMPTY: KitRow = {
  consultant_id: "",
  wa_open_text: "",
  wa_audio_mon_url: null,
  wa_audio_tue_url: null,
  wa_audio_wed_url: null,
  wa_audio_thu_url: null,
  wa_audio_fri_url: null,
  wa_audio_sat_url: null,
  voice_audio_clip_id: null,
  call_tts_fallback: "",
  sms_na_text: "",
  sms_retry_text: "",
  bina_notes: "",
};

interface Props {
  consultantId: string;
}

export function VoiceCycleKitPanel({ consultantId }: Props) {
  const { toast } = useToast();
  const [kit, setKit] = useState<KitRow>({ ...EMPTY, consultant_id: consultantId });
  const [clips, setClips] = useState<Clip[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<WeekdayKey | null>(null);
  const [gates, setGates] = useState<{
    toggle: boolean;
    enabled: boolean;
    live: boolean;
    cap: number;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [kitRes, clipsRes, toggleRes, settingsRes] = await Promise.all([
      (supabase as any).from("daily_reheat_kit").select("*").eq("consultant_id", consultantId).maybeSingle(),
      supabase
        .from("voice_audio_clips")
        .select("id, name, velip_audio_id")
        .eq("consultant_id", consultantId)
        .order("updated_at", { ascending: false })
        .limit(50),
      supabase.from("automation_toggles").select("enabled").eq("key", "daily_reheat").maybeSingle(),
      (supabase as any)
        .from("daily_reheat_settings")
        .select("enabled, live_dispatch_enabled, daily_whapi_cap")
        .eq("id", "global")
        .maybeSingle(),
    ]);

    if (kitRes.data) {
      setKit({ ...(kitRes.data as KitRow) });
    } else {
      setKit({ ...EMPTY, consultant_id: consultantId });
    }
    setClips((clipsRes.data as Clip[]) ?? []);
    const s = settingsRes.data as {
      enabled?: boolean;
      live_dispatch_enabled?: boolean;
      daily_whapi_cap?: number;
    } | null;
    setGates({
      toggle: !!(toggleRes.data as { enabled?: boolean } | null)?.enabled,
      enabled: !!s?.enabled,
      live: !!s?.live_dispatch_enabled,
      cap: Number(s?.daily_whapi_cap ?? 60),
    });
    setLoading(false);
  }, [consultantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    const payload = {
      ...kit,
      consultant_id: consultantId,
      updated_at: new Date().toISOString(),
    };
    const { error } = await (supabase as any).from("daily_reheat_kit").upsert(payload, {
      onConflict: "consultant_id",
    });
    setSaving(false);
    if (error) {
      toast({ title: "Erro ao salvar kit", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Kit do Ciclo salvo", description: "Motor continua OFF até você ativar na Central." });
  };

  const uploadWeekday = async (key: WeekdayKey, file: File) => {
    setUploading(key);
    try {
      const up = await uploadMedia(file, undefined, {
        scope: "admin",
        consultant_id: consultantId,
        kind: "audio",
        slug: `ciclo-${key}`,
      });
      setKit((k) => ({ ...k, [key]: up.url }));
      toast({ title: "Áudio enviado", description: "Salve o kit para gravar." });
    } catch (e) {
      toast({
        title: "Falha no upload",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setUploading(null);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-1">
        <p className="font-heading font-bold text-foreground text-base">
          Kit do Ciclo — coloque os áudios aqui
        </p>
        <p className="text-sm text-muted-foreground">
          Upload dos áudios WhatsApp (segunda a sábado), texto de abertura, áudio/TTS da ligação e SMS.
          O motor continua OFF até ativar na Central.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
        <p className="font-medium text-foreground mb-1">Status do motor (não ativa sozinho)</p>
        <ul className="text-xs text-muted-foreground space-y-0.5">
          <li>Toggle Central `daily_reheat`: {gates?.toggle ? "ON" : "OFF"}</li>
          <li>settings.enabled: {gates?.enabled ? "ON" : "OFF"}</li>
          <li>live_dispatch_enabled: {gates?.live ? "ON" : "OFF"}</li>
          <li>Teto Whapi do ciclo: {gates?.cap}/dia</li>
        </ul>
        <p className="text-[11px] text-muted-foreground mt-2">
          Variáveis: {"{{nome}}"}, {"{{consultor}}"}, {"{{protocolo}}"}. Domingo usa áudio de sábado.
        </p>
      </div>

      <div className="space-y-2">
        <Label>Texto ao abrir atendimento (WhatsApp)</Label>
        <Textarea
          rows={4}
          value={kit.wa_open_text ?? ""}
          onChange={(e) => setKit((k) => ({ ...k, wa_open_text: e.target.value }))}
          placeholder="Oi {{nome}}, aqui é {{consultor}}..."
        />
      </div>

      <div className="space-y-3">
        <Label>Áudios WhatsApp por dia (seg–sáb)</Label>
        <div className="grid gap-3 sm:grid-cols-2">
          {WEEKDAY_FIELDS.map(({ key, label }) => (
            <div key={key} className="rounded-md border border-border p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{label}</span>
                <label className="inline-flex items-center gap-1 cursor-pointer">
                  <input
                    type="file"
                    accept="audio/*,.ogg,.opus,.mp3,.m4a,.wav"
                    className="hidden"
                    disabled={uploading === key}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void uploadWeekday(key, f);
                      e.target.value = "";
                    }}
                  />
                  <span className="inline-flex h-7 items-center gap-1 rounded-md border border-input bg-background px-2 text-xs font-medium hover:bg-accent">
                    {uploading === key ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Upload className="h-3 w-3" />
                    )}
                    Upload
                  </span>
                </label>
              </div>
              <Input
                className="text-xs h-8"
                placeholder="URL do áudio"
                value={kit[key] ?? ""}
                onChange={(e) => setKit((k) => ({ ...k, [key]: e.target.value || null }))}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Áudio da ligação (clip Velip)</Label>
          <Select
            value={kit.voice_audio_clip_id ?? "none"}
            onValueChange={(v) =>
              setKit((k) => ({ ...k, voice_audio_clip_id: v === "none" ? null : v }))
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Selecione clip" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Só TTS (sem clip)</SelectItem>
              {clips.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                  {c.velip_audio_id ? "" : " · sem Velip ainda"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            Clips vêm da aba Nova ligação. Se não tiver velip_audio_id, usa TTS.
          </p>
        </div>
        <div className="space-y-2">
          <Label>TTS fallback (ligação)</Label>
          <Textarea
            rows={3}
            value={kit.call_tts_fallback ?? ""}
            onChange={(e) => setKit((k) => ({ ...k, call_tts_fallback: e.target.value }))}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>SMS se não atender</Label>
          <Textarea
            rows={3}
            value={kit.sms_na_text ?? ""}
            onChange={(e) => setKit((k) => ({ ...k, sms_na_text: e.target.value }))}
          />
        </div>
        <div className="space-y-2">
          <Label>SMS reforço / retry</Label>
          <Textarea
            rows={3}
            value={kit.sms_retry_text ?? ""}
            onChange={(e) => setKit((k) => ({ ...k, sms_retry_text: e.target.value }))}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>BINA / notas (opcional)</Label>
        <Textarea
          rows={2}
          value={kit.bina_notes ?? ""}
          onChange={(e) => setKit((k) => ({ ...k, bina_notes: e.target.value }))}
          placeholder="Números BINA ou observações internas"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => void save()} disabled={saving} className="gap-1.5">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Salvar kit
        </Button>
        <Button type="button" variant="outline" onClick={() => void load()} className="gap-1.5">
          <RefreshCw className="h-4 w-4" />
          Recarregar
        </Button>
      </div>
    </div>
  );
}
