import { useState, useEffect, useCallback } from "react";
import { MessageSquare, Phone, Sparkles, Upload, Mic, Square, Loader2, Music, Check, Headphones } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { uploadMedia } from "@/services/minioUpload";
import { MODEL_V3, prepareTtsSegment, voiceSettingsForModel } from "@/lib/ttsEnhanceV3";
import { useToast } from "@/components/ui/use-toast";
import { sofiaClipOwnerIds } from "@/lib/sofiaClipScope";
import type { SendConfig } from "./types";

interface Props {
  config: SendConfig;
  onChange: (c: SendConfig) => void;
  consultantId: string;
}

interface ClipRow {
  id: string;
  name: string;
  audio_url: string;
  duration_sec: number | null;
  created_at: string;
}

const VOICE_SOFIA = "EJV7H2baGt5ab95tOoSG";
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export function MultichannelStep({ config, onChange, consultantId }: Props) {
  const { toast } = useToast();
  const [clips, setClips] = useState<ClipRow[]>([]);
  const [loadingClips, setLoading] = useState(false);
  const [generatingSofia, setGeneratingSofia] = useState(false);
  const [sofiaText, setSofiaText] = useState("");
  const [uploading, setUploading] = useState(false);

  const loadClips = useCallback(async () => {
    setLoading(true);
    try {
      const owners = await sofiaClipOwnerIds(consultantId);
      const { data } = await (supabase as any)
        .from("voice_audio_clips")
        .select("id, name, audio_url, duration_sec, created_at")
        .in("consultant_id", owners)
        .order("created_at", { ascending: false })
        .limit(20);
      setClips(data || []);
    } finally {
      setLoading(false);
    }
  }, [consultantId]);

  useEffect(() => {
    if (config.makeCall) void loadClips();
  }, [config.makeCall, loadClips]);

  const generateSofia = async () => {
    if (!sofiaText.trim()) return;
    setGeneratingSofia(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) throw new Error("Sessão expirada");

      const prepared = prepareTtsSegment(sofiaText.trim(), MODEL_V3);
      const res = await fetch(`${SUPABASE_URL}/functions/v1/tts-proxy`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          apikey: SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          text: prepared,
          voice_id: VOICE_SOFIA,
          model_id: MODEL_V3,
          voice_settings: voiceSettingsForModel(MODEL_V3),
        }),
      });

      if (!res.ok) throw new Error("Falha na geração");
      const blob = await res.blob();
      const file = new File([blob], `sofia-bulk-${Date.now()}.mp3`, { type: "audio/mpeg" });
      
      const up = await uploadMedia(file, undefined, {
        scope: "admin",
        consultant_id: consultantId,
        kind: "audio",
        slug: "bulk-sofia",
      });

      const { data: clip, error: clipErr } = await (supabase as any)
        .from("voice_audio_clips")
        .insert({
          consultant_id: consultantId,
          name: `Bulk Sofia: ${sofiaText.slice(0, 20)}...`,
          audio_url: up.url,
          voice_id: VOICE_SOFIA,
          model_id: MODEL_V3,
          is_call_body: true,
        })
        .select("id")
        .single();

      if (clipErr) throw clipErr;
      
      onChange({ ...config, callAudioClipId: clip.id });
      await loadClips();
      toast({ title: "Voz Sofia gerada e selecionada" });
    } catch (e: any) {
      toast({ title: "Erro ao gerar Sofia", description: e.message, variant: "destructive" });
    } finally {
      setGeneratingSofia(false);
    }
  };

  const handleFileUpload = async (file: File) => {
    setUploading(true);
    try {
      const up = await uploadMedia(file, undefined, {
        scope: "admin",
        consultant_id: consultantId,
        kind: "audio",
        slug: "bulk-upload",
      });

      const { data: clip, error: clipErr } = await (supabase as any)
        .from("voice_audio_clips")
        .insert({
          consultant_id: consultantId,
          name: `Upload: ${file.name}`,
          audio_url: up.url,
          is_call_body: true,
        })
        .select("id")
        .single();

      if (clipErr) throw clipErr;
      
      onChange({ ...config, callAudioClipId: clip.id });
      await loadClips();
      toast({ title: "Áudio enviado e selecionado" });
    } catch (e: any) {
      toast({ title: "Erro no upload", description: e.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border/40 bg-secondary/10 p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-primary" />
            <h3 className="font-bold">Reforço via SMS</h3>
          </div>
          <Switch 
            checked={config.sendSms} 
            onCheckedChange={(v) => onChange({ ...config, sendSms: v })}
          />
        </div>
        {config.sendSms && (
          <div className="space-y-2 animate-in fade-in slide-in-from-top-1">
            <Label className="text-xs text-muted-foreground">Mensagem SMS (máx 160 chars)</Label>
            <Textarea 
              value={config.smsText} 
              onChange={(e) => onChange({ ...config, smsText: e.target.value.slice(0, 160) })}
              placeholder="Oi {primeiro_nome}, te mandei um áudio no WhatsApp sobre sua conta de luz. Veja lá!"
              className="text-sm h-20"
            />
            <p className="text-[10px] text-right text-muted-foreground">{config.smsText?.length || 0}/160</p>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border/40 bg-secondary/10 p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Phone className="w-5 h-5 text-primary" />
            <h3 className="font-bold">Reforço via Ligação</h3>
          </div>
          <Switch 
            checked={config.makeCall} 
            onCheckedChange={(v) => onChange({ ...config, makeCall: v })}
          />
        </div>
        {config.makeCall && (
          <div className="space-y-4 animate-in fade-in slide-in-from-top-1">
            <div className="space-y-3 p-3 rounded-lg bg-primary/5 border border-primary/20">
              <Label className="text-xs font-bold flex items-center gap-1">
                <Sparkles className="w-3 h-3" /> Gerar agora com Sofia (ElevenLabs v3)
              </Label>
              <Textarea 
                value={sofiaText}
                onChange={(e) => setSofiaText(e.target.value)}
                placeholder="Texto que a Sofia vai falar na ligação..."
                className="text-sm bg-white"
              />
              <Button 
                size="sm" 
                className="w-full gap-2" 
                onClick={generateSofia}
                disabled={generatingSofia || !sofiaText.trim()}
              >
                {generatingSofia ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                Gerar Áudio Profissional
              </Button>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Ou selecione um áudio/faca upload</Label>
              <div className="flex gap-2">
                <Select 
                  value={config.callAudioClipId || "none"} 
                  onValueChange={(v) => onChange({ ...config, callAudioClipId: v === "none" ? "" : v })}
                >
                  <SelectTrigger className="flex-1 bg-white">
                    <SelectValue placeholder="Escolher áudio salvo..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nenhum selecionado</SelectItem>
                    {clips.map(c => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <label className="inline-flex">
                  <Button variant="outline" size="icon" asChild disabled={uploading}>
                    <span>
                      {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    </span>
                  </Button>
                  <input 
                    type="file" 
                    accept="audio/*" 
                    className="hidden" 
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void handleFileUpload(f);
                    }}
                  />
                </label>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
