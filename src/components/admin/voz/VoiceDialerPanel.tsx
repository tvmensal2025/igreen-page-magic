/**
 * Painel B — ligação PSTN (Velip).
 * Página enxuta: teste rápido + teste Sofia (igual à programação) + wizard + campanhas.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Phone, PhoneCall, RefreshCw, Zap, Megaphone, Activity, Download, Headphones, Send } from "lucide-react";
import { toast } from "sonner";
import { normalizeBrazilPhone } from "@/lib/phone";
import { uploadMedia } from "@/services/minioUpload";
import { downloadBlob } from "@/lib/audioProcessing";
import { MODEL_V3, prepareTtsSegment, voiceSettingsForModel } from "@/lib/ttsEnhanceV3";
import { whapiSendMedia } from "@/services/whapiApi";
import { VozCampaignShell, VozSection } from "./VozCampaignShell";
import type { VozCustomer } from "./VozContactPickerDialog";
import { VoiceCampaignWizardDialog } from "./VoiceCampaignWizardDialog";
import { firstName, resolveCustomerByPhone, resolveNameByPhone } from "./voiceContactResolve";
import { crmClosingSummary } from "./voiceCrmContext";
import { isIgreenWalletOrigin } from "@/lib/customerOrigin";

interface Props {
  consultantId: string;
  customers: VozCustomer[];
}

interface CampaignRow {
  id: string;
  name: string;
  status: string;
  total: number;
  dialed: number;
  answered: number;
  failed: number;
  scheduled_at: string | null;
  created_at: string;
  velip_mode: string | null;
  velip_campaign_id: string | null;
}

/** Voz Sofia (ElevenLabs) — mesma do Estúdio / Programação do ciclo. */
const VOICE_SOFIA = "EJV7H2baGt5ab95tOoSG";

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || "https://zlzasfhcxcznaprrragl.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsemFzZmhjeGN6bmFwcnJyYWdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzQ1NzAsImV4cCI6MjA4Njg1MDU3MH0.OJzRdi_Z_1TFZjQXmK8rJofBeHVZc27VSo2vMMw9Spo";

/** Monta o roteiro falado — sempre voz Sofia (ElevenLabs), nunca TTS Velip. */
function buildSofiaSpokenText(opts: {
  body: string;
  leadName?: string | null;
  personalize: boolean;
}): string {
  const body = opts.body.trim();
  if (!opts.personalize) return body;
  const nome = firstName(opts.leadName) || "cliente";
  // Um único trecho (sem concat de MP3) = mesma voz contínua e natural.
  return `Olá, ${nome}! Tudo bem? ${body}`;
}

async function generateSofiaMp3(text: string): Promise<Blob> {
  const session = await supabase.auth.getSession();
  const token = session.data.session?.access_token;
  if (!token) throw new Error("Sessão expirada. Faça login novamente.");
  const spoken = text.trim();
  if (spoken.length < 4) throw new Error("Texto muito curto para gerar áudio Sofia");
  const prepared = prepareTtsSegment(spoken, MODEL_V3);
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
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.error || `Geração Sofia falhou (${res.status})`);
  }
  return await res.blob();
}

type SofiaPrepared = {
  fingerprint: string;
  blob: Blob;
  objectUrl: string;
  publicUrl: string;
  dialClipId: string;
  leadName: string;
  phone: string;
};

function statusLabelPt(status: string): string {
  switch (status) {
    case "running":
      return "Em andamento";
    case "scheduled":
      return "Agendada";
    case "finished":
      return "Finalizada";
    case "paused":
      return "Pausada";
    case "cancelled":
    case "canceled":
      return "Cancelada";
    default:
      return status;
  }
}

function modeLabelPt(mode: string | null): string | null {
  if (!mode) return null;
  if (mode === "single") return "1 a 1";
  if (mode === "batch") return "Em lote";
  return mode;
}

export function VoiceDialerPanel({ consultantId, customers }: Props) {
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [testPhone, setTestPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [sofiaBusy, setSofiaBusy] = useState(false);
  const [sofiaAction, setSofiaAction] = useState<"prep" | "listen" | "download" | "wa" | "call" | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [monitorId, setMonitorId] = useState<string | null>(null);

  const [sofiaText, setSofiaText] = useState(
    "Aqui é da iGreen Energia. Queria falar rapidinho sobre a economia na sua conta de luz. Pode me retornar no WhatsApp quando puder?",
  );
  const [sofiaPersonalize, setSofiaPersonalize] = useState(true);
  const [sofiaDestMode, setSofiaDestMode] = useState<"lead" | "manual">("lead");
  const [sofiaLeadId, setSofiaLeadId] = useState<string>("");
  const [sofiaManualName, setSofiaManualName] = useState("");
  const [sofiaManualPhone, setSofiaManualPhone] = useState("");
  const [sofiaPrepared, setSofiaPrepared] = useState<SofiaPrepared | null>(null);

  const leadOptions = useMemo(() => {
    return customers
      .filter((c) => c.phone_whatsapp && !isIgreenWalletOrigin(c.customer_origin))
      .slice(0, 400);
  }, [customers]);

  const selectedLead = useMemo(
    () => leadOptions.find((c) => c.id === sofiaLeadId) ?? null,
    [leadOptions, sofiaLeadId],
  );

  const sofiaTarget = useMemo(() => {
    if (sofiaDestMode === "manual") {
      const phone = normalizeBrazilPhone(sofiaManualPhone);
      const name = sofiaManualName.trim() || "cliente";
      return phone ? { phone, name, source: "manual" as const } : null;
    }
    if (!selectedLead) return null;
    const phone = normalizeBrazilPhone(selectedLead.phone_whatsapp);
    if (!phone) return null;
    return {
      phone,
      name: selectedLead.name?.trim() || "cliente",
      source: "lead" as const,
    };
  }, [sofiaDestMode, sofiaManualName, sofiaManualPhone, selectedLead]);

  const sofiaFingerprint = useMemo(() => {
    return [
      sofiaText.trim(),
      sofiaPersonalize ? "1" : "0",
      sofiaDestMode,
      sofiaTarget?.phone || "",
      sofiaTarget?.name || "",
    ].join("|");
  }, [sofiaText, sofiaPersonalize, sofiaDestMode, sofiaTarget]);

  useEffect(() => {
    setSofiaPrepared((prev) => {
      if (prev?.objectUrl) URL.revokeObjectURL(prev.objectUrl);
      return null;
    });
  }, [sofiaFingerprint]);

  useEffect(() => {
    return () => {
      if (sofiaPrepared?.objectUrl) URL.revokeObjectURL(sofiaPrepared.objectUrl);
    };
  }, [sofiaPrepared?.objectUrl]);

  const testCrm = useMemo(
    () => resolveCustomerByPhone(testPhone, customers),
    [testPhone, customers],
  );
  const testPhoneName = useMemo(
    () => testCrm?.name?.trim() || resolveNameByPhone(testPhone, customers),
    [testCrm, testPhone, customers],
  );

  const loadCampaigns = useCallback(async () => {
    const { data } = await (supabase as any)
      .from("voice_campaigns")
      .select("id, name, status, total, dialed, answered, failed, scheduled_at, created_at, velip_mode, velip_campaign_id")
      .eq("consultant_id", consultantId)
      .order("created_at", { ascending: false })
      .limit(15);
    setCampaigns((data as CampaignRow[]) ?? []);
  }, [consultantId]);

  useEffect(() => {
    void loadCampaigns();
  }, [loadCampaigns]);

  const invokeEnqueue = async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("voice-dialer-enqueue", { body });
    if (error) {
      // non-2xx: corpo JSON fica em error.context (FunctionsHttpError)
      let fromCtx: Record<string, unknown> | null = null;
      try {
        const ctx = (error as { context?: Response })?.context;
        if (ctx && typeof ctx.json === "function") {
          fromCtx = (await ctx.json()) as Record<string, unknown>;
        }
      } catch {
        /* ignore */
      }
      const msg =
        (typeof fromCtx?.message === "string" && fromCtx.message) ||
        (typeof fromCtx?.detail === "string" && fromCtx.detail) ||
        (typeof fromCtx?.error === "string" && fromCtx.error) ||
        error.message;
      throw new Error(msg);
    }
    if (data?.error) {
      const msg = data.message || data.detail || data.error;
      throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
    }
    return data;
  };

  const DEFAULT_SOFIA_BODY =
    "Aqui é da iGreen Energia. Esta é uma ligação de teste. O sistema está funcionando. Até logo!";

  /** Gera MP3 Sofia → MinIO → voice_audio_clips. Nunca usa TTS Velip. */
  const persistSofiaClip = async (opts: {
    spokenText: string;
    clipLabel: string;
  }): Promise<{ blob: Blob; publicUrl: string; dialClipId: string }> => {
    const blob = await generateSofiaMp3(opts.spokenText);
    const file = new File([blob], `teste-sofia-${Date.now()}.mp3`, { type: "audio/mpeg" });
    const up = await uploadMedia(file, undefined, {
      scope: "admin",
      consultant_id: consultantId,
      kind: "audio",
      slug: "teste-sofia",
    });
    const { data: clip, error: clipErr } = await (supabase as any)
      .from("voice_audio_clips")
      .insert({
        consultant_id: consultantId,
        name: opts.clipLabel,
        audio_url: up.url,
        voice_id: VOICE_SOFIA,
        model_id: MODEL_V3,
        is_call_body: true,
      })
      .select("id, audio_url")
      .single();
    if (clipErr || !clip?.id) {
      throw new Error(clipErr?.message || "Falha ao salvar clipe Sofia");
    }
    return {
      blob,
      publicUrl: (clip.audio_url as string) || up.url,
      dialClipId: clip.id as string,
    };
  };

  const runTestCall = async () => {
    const phone = normalizeBrazilPhone(testPhone);
    if (!phone) {
      toast.error("Informe um celular válido com DDD");
      return;
    }
    const leadName = testPhoneName || "Teste";
    const nome = firstName(leadName) || "cliente";
    const spoken = buildSofiaSpokenText({
      body: DEFAULT_SOFIA_BODY,
      leadName,
      personalize: true,
    });
    setBusy(true);
    try {
      toast.message("Gerando áudio Sofia (voz profissional)…");
      const clip = await persistSofiaClip({
        spokenText: spoken,
        clipLabel: `Teste rápido Sofia · ${nome} · ${new Date().toLocaleString("pt-BR")}`,
      });
      const data = await invokeEnqueue({
        action: "test_call",
        test_phone: phone,
        test_name: leadName,
        audio_clip_id: clip.dialClipId,
        audio_url: clip.publicUrl,
        dispatch_kind: "audio",
        campaign_name: "Teste rápido Sofia",
        config: { sofia_test: true, personalize_name: true },
      });
      toast.success("Sofia está ligando — atenda o telefone!");
      await loadCampaigns();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const prepareSofiaAudio = async (): Promise<SofiaPrepared> => {
    if (sofiaPrepared && sofiaPrepared.fingerprint === sofiaFingerprint) {
      return sofiaPrepared;
    }
    const bodyText = sofiaText.trim();
    if (bodyText.length < 8) {
      throw new Error("Digite o texto do corpo da ligação (mín. 8 caracteres)");
    }
    if (!sofiaTarget) {
      throw new Error(
        sofiaDestMode === "manual"
          ? "Informe nome e celular válido (com DDD) para o teste"
          : "Selecione um lead",
      );
    }
    if (sofiaDestMode === "manual" && sofiaPersonalize && !sofiaManualName.trim()) {
      throw new Error("Informe o nome — ele entra no áudio Sofia (“Olá, Nome.”)");
    }
    const phone = sofiaTarget.phone;
    const leadName = sofiaTarget.name;
    const nome = firstName(leadName) || "cliente";
    const spoken = buildSofiaSpokenText({
      body: bodyText,
      leadName,
      personalize: sofiaPersonalize,
    });

    toast.message("Gerando áudio Sofia (voz profissional)…");
    const clip = await persistSofiaClip({
      spokenText: spoken,
      clipLabel: `Teste Sofia · ${nome} · ${new Date().toLocaleString("pt-BR")}`,
    });

    const objectUrl = URL.createObjectURL(clip.blob);
    const prepared: SofiaPrepared = {
      fingerprint: sofiaFingerprint,
      blob: clip.blob,
      objectUrl,
      publicUrl: clip.publicUrl,
      dialClipId: clip.dialClipId,
      leadName,
      phone,
    };
    setSofiaPrepared((prev) => {
      if (prev?.objectUrl && prev.objectUrl !== objectUrl) URL.revokeObjectURL(prev.objectUrl);
      return prepared;
    });
    return prepared;
  };

  const runSofiaListen = async () => {
    setSofiaBusy(true);
    setSofiaAction("listen");
    try {
      const prep = await prepareSofiaAudio();
      toast.success("Áudio pronto — use o player abaixo");
      // autoplay leve
      const a = new Audio(prep.objectUrl);
      void a.play().catch(() => {});
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSofiaBusy(false);
      setSofiaAction(null);
    }
  };

  const runSofiaDownload = async () => {
    setSofiaBusy(true);
    setSofiaAction("download");
    try {
      const prep = await prepareSofiaAudio();
      const slug = firstName(prep.leadName) || "lead";
      downloadBlob(prep.blob, `sofia-${slug}-${Date.now()}.mp3`);
      toast.success("Download iniciado");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSofiaBusy(false);
      setSofiaAction(null);
    }
  };

  const runSofiaWhatsApp = async () => {
    setSofiaBusy(true);
    setSofiaAction("wa");
    try {
      const prep = await prepareSofiaAudio();
      toast.message("Enviando áudio no WhatsApp…");
      await whapiSendMedia(
        prep.phone,
        prep.publicUrl,
        "audio",
        undefined,
        `sofia-${firstName(prep.leadName) || "audio"}.mp3`,
        { intent: "reply" },
      );
      toast.success(`Áudio Sofia enviado no WhatsApp para ${firstName(prep.leadName) || prep.leadName}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSofiaBusy(false);
      setSofiaAction(null);
    }
  };

  const runSofiaTestCall = async () => {
    setSofiaBusy(true);
    setSofiaAction("call");
    try {
      const prep = await prepareSofiaAudio();
      const nome = firstName(prep.leadName) || "cliente";
      const data = await invokeEnqueue({
        action: "test_call",
        test_phone: prep.phone,
        test_name: prep.leadName,
        audio_clip_id: prep.dialClipId,
        audio_url: prep.publicUrl,
        dispatch_kind: "audio",
        campaign_name: `Teste Sofia · ${nome}`,
        config: { personalize_name: sofiaPersonalize, sofia_test: true },
      });
      toast.success(`Sofia está ligando para ${nome} — atenda o telefone!`);
      await loadCampaigns();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSofiaBusy(false);
      setSofiaAction(null);
    }
  };

  const openNewCampaign = () => {
    setMonitorId(null);
    setWizardOpen(true);
  };

  const openMonitor = (campaignId: string) => {
    setMonitorId(campaignId);
    setWizardOpen(true);
  };

  return (
    <>
      <VozCampaignShell
        title="Ligação telefônica"
        subtitle="Follow-up com leads do CRM · áudio ~20s · acompanhe no modal como o disparo automático."
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2 w-full">
            <span className="text-sm" style={{ color: "var(--pe-text-muted)" }}>
              {campaigns.filter((c) => c.status === "running" || c.status === "scheduled").length} em andamento
            </span>
            <Button
              type="button"
              onClick={openNewCampaign}
              className="gap-1.5"
              style={{ background: "var(--pe-emerald)", color: "#fff" }}
            >
              <Megaphone className="h-4 w-4" />
              Nova campanha de ligação
            </Button>
          </div>
        }
      >
        <VozSection title="Teste rápido — 1 clique">
          <div
            className="rounded-[var(--pe-radius)] border p-3 space-y-2.5"
            style={{ borderColor: "var(--pe-emerald-20)", background: "var(--pe-emerald-10)" }}
          >
            <p className="flex items-center gap-1.5 text-sm" style={{ color: "var(--pe-text)" }}>
              <Zap className="h-4 w-4 shrink-0" style={{ color: "var(--pe-emerald)" }} />
              <span>
                Liga no seu celular com áudio Sofia (voz profissional ElevenLabs). Nunca usa TTS genérico.
              </span>
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="flex-1 space-y-1">
                <Input
                  className="bg-white/70 dark:bg-black/20"
                  placeholder="Seu celular com DDD — ex: 11 99999-9999"
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                />
                {testPhoneName && (
                  <div className="space-y-0.5">
                    <p className="text-[11px] font-medium" style={{ color: "var(--pe-emerald-strong)" }}>
                      Contato CRM: {testPhoneName}
                      {firstName(testPhoneName) ? ` · fala com ${firstName(testPhoneName)}` : ""}
                    </p>
                    {testCrm && (
                      <p className="text-[10px] line-clamp-2" style={{ color: "var(--pe-text-muted)" }}>
                        {crmClosingSummary(testCrm)}
                      </p>
                    )}
                  </div>
                )}
              </div>
              <Button
                type="button"
                className="gap-1.5 font-semibold shrink-0"
                style={{ background: "var(--pe-emerald)", color: "#fff" }}
                onClick={() => void runTestCall()}
                disabled={busy || sofiaBusy}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PhoneCall className="h-4 w-4" />}
                Ligar agora
              </Button>
            </div>
            <p className="text-[11px]" style={{ color: "var(--pe-text-muted)" }}>
              Custo aproximado: R$ 0,09 (até 30s) a R$ 0,12 (até 42s) por chamada atendida.
            </p>
          </div>
        </VozSection>

        <VozSection title="Teste Sofia — igual à programação">
          <div
            className="rounded-[var(--pe-radius)] border p-3 space-y-3"
            style={{ borderColor: "var(--pe-border)", background: "var(--pe-surface)" }}
          >
            <p className="text-sm" style={{ color: "var(--pe-text-muted)" }}>
              Corpo + nome (opcional) saem num <strong>único áudio Sofia</strong> — mesma voz do Estúdio.
              Sem TTS genérico.
            </p>

            <div className="space-y-1.5">
              <Label>Texto do corpo (Sofia)</Label>
              <Textarea
                rows={4}
                value={sofiaText}
                onChange={(e) => setSofiaText(e.target.value)}
                placeholder="Aqui é da iGreen… (sem dizer o nome — o nome vai na frente se personalizar)"
                disabled={sofiaBusy}
              />
            </div>

            <div className="flex items-start gap-2 rounded-md border border-border/60 p-2.5">
              <Switch
                checked={sofiaPersonalize}
                onCheckedChange={setSofiaPersonalize}
                id="sofia-personalize"
                className="mt-0.5"
                disabled={sofiaBusy}
              />
              <div>
                <Label htmlFor="sofia-personalize">Personalizar com nome (Sofia)</Label>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Gera &quot;Olá, {"{Nome}"}. + corpo&quot; na mesma voz Sofia (um trecho só).
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Quem recebe a ligação / WhatsApp</Label>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={sofiaDestMode === "lead" ? "default" : "outline"}
                  onClick={() => setSofiaDestMode("lead")}
                  disabled={sofiaBusy}
                >
                  Lead da lista
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={sofiaDestMode === "manual" ? "default" : "outline"}
                  onClick={() => setSofiaDestMode("manual")}
                  disabled={sofiaBusy}
                >
                  Digitar nome + telefone
                </Button>
              </div>

              {sofiaDestMode === "lead" ? (
                <div className="space-y-1.5">
                  <Select
                    value={sofiaLeadId || "none"}
                    onValueChange={(v) => setSofiaLeadId(v === "none" ? "" : v)}
                    disabled={sofiaBusy}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione um lead" />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      <SelectItem value="none">Selecione um lead…</SelectItem>
                      {leadOptions.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {(c.name || "Sem nome").slice(0, 40)}
                          {" · "}
                          {normalizeBrazilPhone(c.phone_whatsapp) || c.phone_whatsapp}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {leadOptions.length === 0 && (
                    <p className="text-[11px] text-muted-foreground">
                      Nenhum lead na lista. Use &quot;Digitar nome + telefone&quot; para teste.
                    </p>
                  )}
                </div>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-[11px]">Nome (falado pela Sofia)</Label>
                    <Input
                      placeholder="Ex: Maria"
                      value={sofiaManualName}
                      onChange={(e) => setSofiaManualName(e.target.value)}
                      disabled={sofiaBusy}
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Entra no áudio Sofia: &quot;Olá, Maria.&quot; — não usa voz genérica.
                    </p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">Telefone com DDD</Label>
                    <Input
                      placeholder="11 99999-9999"
                      value={sofiaManualPhone}
                      onChange={(e) => setSofiaManualPhone(e.target.value)}
                      disabled={sofiaBusy}
                    />
                  </div>
                </div>
              )}

              {sofiaTarget && (
                <p className="text-[11px]" style={{ color: "var(--pe-emerald-strong)" }}>
                  Vai para {firstName(sofiaTarget.name) || sofiaTarget.name} · {sofiaTarget.phone}
                  {sofiaPersonalize
                    ? ` · roteiro Sofia: “Olá, ${firstName(sofiaTarget.name) || "…"}.” + corpo (1 áudio)`
                    : " · roteiro Sofia: só o corpo"}
                  {sofiaTarget.source === "manual" ? " · teste manual" : ""}
                </p>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                className="gap-1.5 font-semibold"
                onClick={() => void runSofiaListen()}
                disabled={sofiaBusy || busy || !sofiaTarget}
              >
                {sofiaAction === "listen" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Headphones className="h-4 w-4" />
                )}
                Escutar
              </Button>
              <Button
                type="button"
                variant="outline"
                className="gap-1.5 font-semibold"
                onClick={() => void runSofiaDownload()}
                disabled={sofiaBusy || busy || !sofiaTarget}
              >
                {sofiaAction === "download" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                Baixar
              </Button>
              <Button
                type="button"
                variant="outline"
                className="gap-1.5 font-semibold"
                onClick={() => void runSofiaWhatsApp()}
                disabled={sofiaBusy || busy || !sofiaTarget}
              >
                {sofiaAction === "wa" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                WhatsApp
              </Button>
              <Button
                type="button"
                className="gap-1.5 font-semibold"
                style={{ background: "var(--pe-emerald)", color: "#fff" }}
                onClick={() => void runSofiaTestCall()}
                disabled={sofiaBusy || busy || !sofiaTarget}
              >
                {sofiaAction === "call" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <PhoneCall className="h-4 w-4" />
                )}
                Ligar
              </Button>
            </div>

            {sofiaPrepared && sofiaPrepared.fingerprint === sofiaFingerprint && (
              <div className="space-y-1">
                <Label className="text-[11px]">Prévia Sofia</Label>
                <audio controls src={sofiaPrepared.objectUrl} className="w-full" />
              </div>
            )}
          </div>
        </VozSection>

        <VozSection title="Campanha em massa">
          <div
            className="rounded-[var(--pe-radius)] border p-4 flex flex-col sm:flex-row sm:items-center gap-4"
            style={{ borderColor: "var(--pe-border)", background: "var(--pe-surface)" }}
          >
            <div className="flex-1 space-y-1">
              <p className="font-medium" style={{ color: "var(--pe-text)" }}>
                Contatos → mensagem → iniciar → acompanhar
              </p>
              <p className="text-sm" style={{ color: "var(--pe-text-muted)" }}>
                Abre um modal com passos (igual ao disparo automático). Sem chips confusos de dias — o período fica num select dentro do passo Contatos.
              </p>
            </div>
            <Button
              type="button"
              size="lg"
              className="gap-2 shrink-0"
              style={{ background: "var(--pe-emerald)", color: "#fff" }}
              onClick={openNewCampaign}
            >
              <Phone className="h-4 w-4" />
              Abrir campanha
            </Button>
          </div>
        </VozSection>

        <VozSection title="Campanhas recentes">
          <div className="flex justify-end mb-1">
            <Button type="button" variant="ghost" size="sm" onClick={() => void loadCampaigns()}>
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
          {campaigns.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma ainda. Crie a primeira pelo botão acima.</p>
          ) : (
            <ul className="space-y-2">
              {campaigns.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => openMonitor(c.id)}
                    className="w-full flex flex-wrap items-center gap-2 rounded-[var(--pe-radius)] border px-3 py-2.5 text-sm text-left transition hover:border-[var(--pe-emerald)]"
                    style={{ borderColor: "var(--pe-border)", background: "var(--pe-surface)" }}
                  >
                    <span className="font-medium truncate flex-1" style={{ color: "var(--pe-text)" }}>{c.name}</span>
                    <Badge variant="secondary">{statusLabelPt(c.status)}</Badge>
                    {modeLabelPt(c.velip_mode) && (
                      <Badge variant="outline" className="text-[10px]">{modeLabelPt(c.velip_mode)}</Badge>
                    )}
                    <span className="text-muted-foreground text-xs">
                      ligou {c.dialed}/{c.total} · atendeu {c.answered} · falhou {c.failed}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium" style={{ color: "var(--pe-emerald-strong)" }}>
                      <Activity className="h-3.5 w-3.5" /> Acompanhar
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </VozSection>
      </VozCampaignShell>

      <VoiceCampaignWizardDialog
        open={wizardOpen}
        onOpenChange={(o) => {
          setWizardOpen(o);
          if (!o) {
            setMonitorId(null);
            void loadCampaigns();
          }
        }}
        consultantId={consultantId}
        customers={customers}
        monitorCampaignId={monitorId}
        onCampaignsChanged={() => void loadCampaigns()}
      />
    </>
  );
}
