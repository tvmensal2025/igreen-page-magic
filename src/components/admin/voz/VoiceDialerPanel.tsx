/**
 * Painel B — ligação PSTN (Velip).
 * Página enxuta: teste rápido + CTA para modal wizard (estilo Disparo automático)
 * + lista de campanhas recentes com acompanhamento.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Phone, PhoneCall, RefreshCw, Zap, Megaphone, Activity } from "lucide-react";
import { toast } from "sonner";
import { normalizeBrazilPhone } from "@/lib/phone";
import { VozCampaignShell, VozSection } from "./VozCampaignShell";
import type { VozCustomer } from "./VozContactPickerDialog";
import { VoiceCampaignWizardDialog } from "./VoiceCampaignWizardDialog";
import { firstName, resolveNameByPhone } from "./voiceContactResolve";

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

export function VoiceDialerPanel({ consultantId, customers }: Props) {
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [testPhone, setTestPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [monitorId, setMonitorId] = useState<string | null>(null);

  const testPhoneName = useMemo(
    () => resolveNameByPhone(testPhone, customers),
    [testPhone, customers],
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
    if (error) throw new Error(error.message);
    if (data?.error) {
      const msg = data.message || data.detail || data.error;
      throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
    }
    return data;
  };

  const DEFAULT_TEST_TTS =
    "Olá! Esta é uma ligação de teste da iGreen. O sistema de ligações está funcionando perfeitamente. Até logo!";

  const runTestCall = async () => {
    const phone = normalizeBrazilPhone(testPhone);
    if (!phone) {
      toast.error("Informe um celular válido com DDD");
      return;
    }
    const nome = firstName(testPhoneName) || "cliente";
    const tts = DEFAULT_TEST_TTS.replace(/\{\{\s*nome\s*\}\}/gi, nome).replace(/\{\s*nome\s*\}/gi, nome);
    setBusy(true);
    try {
      // Preferir áudio mais recente se existir; senão TTS de teste.
      const { data: clips } = await (supabase as any)
        .from("voice_audio_clips")
        .select("id, audio_url")
        .eq("consultant_id", consultantId)
        .order("created_at", { ascending: false })
        .limit(1);
      const clip = (clips as { id: string; audio_url: string }[] | null)?.[0];
      const data = await invokeEnqueue({
        action: "test_call",
        test_phone: phone,
        audio_clip_id: clip?.id ?? null,
        audio_url: clip?.audio_url ?? null,
        dispatch_kind: clip ? "audio" : "tts",
        tts_text: clip ? null : tts,
        campaign_name: "Teste rápido",
      });
      toast.success(`Ligação disparada — atenda o telefone! (ID: ${data.velip_call_id || data.campaign_id})`);
      await loadCampaigns();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
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
        subtitle="Número da empresa (Velip) · áudio ~20s · acompanhe a campanha num modal, como o disparo automático."
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2 w-full">
            <span className="text-sm" style={{ color: "var(--pe-text-muted)" }}>
              {campaigns.filter((c) => c.status === "running" || c.status === "scheduled").length} campanha(s) ativa(s)
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
                Liga no seu celular para validar o sistema. Usa o último áudio salvo ou voz sintetizada.
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
                  <p className="text-[11px] font-medium" style={{ color: "var(--pe-emerald-strong)" }}>
                    Contato: {testPhoneName}
                    {firstName(testPhoneName) ? ` · fala com ${firstName(testPhoneName)}` : ""}
                  </p>
                )}
              </div>
              <Button
                type="button"
                className="gap-1.5 font-semibold shrink-0"
                style={{ background: "var(--pe-emerald)", color: "#fff" }}
                onClick={() => void runTestCall()}
                disabled={busy}
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
                    <Badge variant="secondary">{c.status}</Badge>
                    {c.velip_mode && <Badge variant="outline" className="text-[10px]">{c.velip_mode}</Badge>}
                    <span className="text-muted-foreground text-xs">
                      {c.dialed}/{c.total} · ok {c.answered} · falha {c.failed}
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
