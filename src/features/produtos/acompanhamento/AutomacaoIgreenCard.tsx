import { useEffect, useRef, useState } from "react";
import { Loader2, Volume2, Send } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { toUserFacingError } from "@/lib/userFacingError";
import { supabase } from "@/integrations/supabase/client";
import { validateBrazilPhone, formatBrazilPhone } from "@/lib/phone";
import {
  prepareTtsSegment,
  voiceSettingsForModel,
  MODEL_V3,
} from "@/lib/ttsEnhanceV3";
import { VOICE_SOFIA_PROFESSIONAL } from "@/lib/sofiaTtsCache";
import { uploadMedia } from "@/services/minioUpload";
import { whapiSendMedia, whapiSendText, whapiSendButtons } from "@/services/whapiApi";
import {
  useAutomationSettings,
  useUpdateAutomationSetting,
  type AutomationSettings,
} from "./automationSettings";
import {
  useBoletoNotifyConfig,
  useUpdateBoletoNotifyConfig,
  DEFAULT_BOLETO_AUDIO_BODY,
  IGREEN_CLUB_PLAY_STORE_URL,
  IGREEN_CLUB_APP_STORE_URL,
  boletoAppStoreChoiceOptions,
  buildAppStoreButtonsPrompt,
  buildAppStoreNumberedMessage,
  buildBoletoButtonPrompt,
  stripBoletoButtonCta,
  type BoletoNotifyConfig,
} from "./boletoNotifyConfig";

type Key = keyof Omit<AutomationSettings, "consultant_id">;

const OLA_PREFIX_LABEL = "Olá, {Nome}! Tudo bem?";

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || "https://zlzasfhcxcznaprrragl.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsemFzZmhjeGN6bmFwcnJyYWdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzQ1NzAsImV4cCI6MjA4Njg1MDU3MH0.OJzRdi_Z_1TFZjQXmK8rJofBeHVZc27VSo2vMMw9Spo";

const GROUPS: { title: string; hint: string; items: { key: Key; label: string; desc: string }[] }[] = [
  {
    title: "Alertas e tarefas",
    hint: "Aparecem no seu painel para você agir. Não envia nada pro cliente.",
    items: [
      { key: "alert_boletos_vencendo", label: "Avisar quando um boleto do cliente estiver perto de vencer", desc: "Aparece um aviso no seu painel para você agir." },
      { key: "alert_devolutivas", label: "Avisar quando um cliente for reprovado ou tiver pendência no cadastro", desc: "Aparece no painel para você resolver." },
      { key: "alert_licencas_expirando", label: "Avisar quando um consultor da sua rede estiver perto de perder a licença", desc: "Ajuda você a reter sua rede." },
      { key: "rotinas_tarefas", label: "Criar tarefas automáticas todo dia (aniversariantes, clientes esfriando, quem sumiu)", desc: "Aparecem na sua lista de tarefas." },
    ],
  },
  {
    title: "Automação no WhatsApp",
    hint: "⚠️ Estas opções mandam mensagem sozinhas para o cliente. Ligue só se quiser que aconteça sem você precisar aprovar cada uma.",
    items: [
      {
        key: "auto_wa_boleto_chegou",
        label: "Avisar quando o boleto do mês chegar (WhatsApp)",
        desc: "Áudio e/ou texto + sempre os links do app (Android/iOS). Botão do arquivo no Zap é opcional. Desligado por padrão.",
      },
      { key: "auto_wa_boleto_vencendo", label: "Enfileirar aviso de boleto a vencer (WhatsApp)", desc: "Cria alerta no painel; envio real só com liberação na Central." },
      { key: "auto_wa_aniversariante", label: "Enfileirar parabéns de aniversário (WhatsApp)", desc: "Cria alerta no painel; envio real só com liberação na Central." },
      { key: "cross_sell_bot", label: "Sugerir Telefonia e Seguro Auto (bot, modo sombra)", desc: "Quando ligado, o bot avalia cross-sell em sombra (log) até ativação explícita." },
    ],
  },
];

function firstName(raw: string): string {
  return String(raw || "").trim().split(/\s+/)[0] || "";
}

function buildSpokenPreview(body: string, name: string): string {
  const n = firstName(name);
  const corpus = (body || DEFAULT_BOLETO_AUDIO_BODY).trim();
  if (!n) return corpus;
  return `Olá, ${n}! Tudo bem? ${corpus}`;
}

function formatValor(total: unknown): string {
  const n = typeof total === "number" ? total : Number(total);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatVenc(raw: unknown): string {
  const s = String(raw || "").trim();
  if (!s) return "—";
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const [y, m, d] = s.slice(0, 10).split("-");
    return `${d}/${m}/${y}`;
  }
  return s;
}

function renderWaTemplate(raw: string, vars: Record<string, string>): string {
  let out = String(raw || "");
  for (const [k, v] of Object.entries(vars)) {
    out = out.replace(new RegExp(`\\{\\{${k}\\}\\}`, "gi"), v);
  }
  return out.trim();
}

export function AutomacaoIgreenCard({ consultantId }: { consultantId?: string }) {
  const { toast } = useToast();
  const { data: settings, isLoading } = useAutomationSettings(consultantId);
  const update = useUpdateAutomationSetting(consultantId);
  const { data: boletoCfg, isLoading: cfgLoading } = useBoletoNotifyConfig();
  const updateCfg = useUpdateBoletoNotifyConfig();
  const [draft, setDraft] = useState<Partial<BoletoNotifyConfig> | null>(null);
  const [showTexts, setShowTexts] = useState(true);

  const [previewName, setPreviewName] = useState("Maria");
  const [testPhone, setTestPhone] = useState("");
  const [audioBusy, setAudioBusy] = useState(false);
  const [sendBusy, setSendBusy] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const cfg = { ...(boletoCfg || {}), ...(draft || {}) } as BoletoNotifyConfig;

  useEffect(() => {
    return () => {
      if (audioUrl?.startsWith("blob:")) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  const onToggle = (key: Key, value: boolean) => {
    update.mutate(
      { [key]: value } as Partial<AutomationSettings>,
      {
        onSuccess: () => toast({ title: value ? "Ativado" : "Desativado", description: "Preferência salva." }),
        onError: (e) =>
          toast({
            title: "Erro ao salvar",
            description: toUserFacingError(e),
            variant: "destructive",
          }),
      },
    );
  };

  const saveCfg = () => {
    const patch = {
      ...cfg,
      ...draft,
      button_boleto_label: String(
        (draft?.button_boleto_label ?? cfg.button_boleto_label) || "Receber boleto",
      ).slice(0, 25),
      send_audio: (draft?.send_audio ?? cfg.send_audio) !== false,
      send_text: (draft?.send_text ?? cfg.send_text) !== false,
      button_enabled: (draft?.button_enabled ?? cfg.button_enabled) === true,
    };
    updateCfg.mutate(patch, {
      onSuccess: () => {
        setDraft(null);
        toast({ title: "Textos salvos", description: "Valem no próximo aviso de boleto." });
      },
      onError: (e) =>
        toast({
          title: "Erro ao salvar textos",
          description: toUserFacingError(e),
          variant: "destructive",
        }),
    });
  };

  const generateMp3Blob = async (spoken: string): Promise<Blob> => {
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    if (!token) throw new Error("Faça login novamente.");
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
        voice_id: VOICE_SOFIA_PROFESSIONAL,
        model_id: MODEL_V3,
        voice_settings: voiceSettingsForModel(MODEL_V3),
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.error || `Falha ao gerar áudio (${res.status})`);
    }
    return await res.blob();
  };

  const generateAndListen = async () => {
    setAudioBusy(true);
    try {
      const spoken = buildSpokenPreview(cfg.audio_script, previewName);
      const blob = await generateMp3Blob(spoken);
      if (audioUrl?.startsWith("blob:")) URL.revokeObjectURL(audioUrl);
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);
      requestAnimationFrame(() => {
        void audioRef.current?.play().catch(() => undefined);
      });
      toast({ title: "Áudio pronto", description: "Ouça abaixo. Abertura: Olá, Nome! Tudo bem?" });
    } catch (e) {
      toast({
        title: "Erro ao gerar áudio",
        description: toUserFacingError(e),
        variant: "destructive",
      });
    } finally {
      setAudioBusy(false);
    }
  };

  const sendTest = async () => {
    const v = validateBrazilPhone(testPhone);
    if (!v.valid) {
      toast({ title: "Telefone inválido", description: v.message, variant: "destructive" });
      return;
    }
    if (!consultantId) {
      toast({
        title: "Consultor não identificado",
        description: "Recarregue a página e tente de novo.",
        variant: "destructive",
      });
      return;
    }
    setSendBusy(true);
    try {
      if (draft) {
        await new Promise<void>((resolve, reject) => {
          updateCfg.mutate(draft, {
            onSuccess: () => {
              setDraft(null);
              resolve();
            },
            onError: (e) => reject(e),
          });
        });
      }

      const phone = v.normalized;
      const phoneVariants = Array.from(
        new Set([
          phone,
          phone.slice(2),
          phone.length === 13 ? `${phone.slice(0, 4)}${phone.slice(5)}` : "",
        ]),
      ).filter(Boolean);

      const { data: cust } = await supabase
        .from("customers")
        .select("id, name, igreen_code, phone_whatsapp")
        .eq("consultant_id", consultantId)
        .or(phoneVariants.map((p) => `phone_whatsapp.eq.${p}`).join(","))
        .limit(1)
        .maybeSingle();

      // Boleto só preenche mês/valor/vencimento. Sem boleto → placeholders (teste de layout).
      type BoletoRow = {
        url_boleto: string | null;
        total: number | null;
        vencimento: string | null;
        mes_referencia: string | null;
        nome: string | null;
        idcliente: number | null;
        customer_id: string | null;
      };
      const pickBoleto = async (customerOnly: boolean): Promise<BoletoRow[]> => {
        let q = supabase
          .from("igreen_customer_boletos")
          .select("url_boleto, total, vencimento, mes_referencia, nome, idcliente, customer_id")
          .eq("consultant_id", consultantId)
          .order("synced_at", { ascending: false })
          .limit(30);
        if (customerOnly && cust?.id) q = q.eq("customer_id", cust.id);
        const { data, error } = await q;
        if (error) throw error;
        return (data || []) as BoletoRow[];
      };
      let list = await pickBoleto(true);
      if (list.length === 0 && cust?.id) list = await pickBoleto(false);

      const now = new Date();
      const mesDemo = `${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`;
      const boleto: BoletoRow = list[0] || {
        url_boleto: null,
        total: 189.9,
        vencimento: new Date(now.getFullYear(), now.getMonth(), 15).toISOString().slice(0, 10),
        mes_referencia: mesDemo,
        nome: cust?.name || previewName || "Maria",
        idcliente: Number(String(cust?.igreen_code || "").replace(/\D/g, "")) || null,
        customer_id: cust?.id || null,
      };
      const usedDemo = list.length === 0;

      const wantAudio = cfg.send_audio !== false;
      const wantText = cfg.send_text !== false;
      const wantBoletoBtn = cfg.button_enabled === true;
      if (wantBoletoBtn && !String(boleto.url_boleto || "").trim()) {
        throw new Error(
          "Botão “Receber boleto” está ligado, mas não há boleto com link. Desligue o botão para testar o aviso, ou rode o sync de boletos.",
        );
      }

      const clubId = String(boleto.idcliente || cust?.igreen_code || "").replace(/\D/g, "");
      const linkClub = clubId
        ? `https://club.igreenenergy.com.br/?id=${clubId}`
        : "https://club.igreenenergy.com.br/";

      const nome =
        firstName(previewName) ||
        firstName(cust?.name || "") ||
        firstName(boleto.nome || "") ||
        "Maria";
      const saudacao = `Oi ${nome}, `;
      const waText = renderWaTemplate(cfg.wa_text, {
        saudacao,
        nome,
        mes: boleto.mes_referencia || "—",
        valor: formatValor(boleto.total),
        vencimento: formatVenc(boleto.vencimento),
        link_club: linkClub,
        link_play: IGREEN_CLUB_PLAY_STORE_URL,
        link_appstore: IGREEN_CLUB_APP_STORE_URL,
        url_boleto: boleto.url_boleto || "",
      });
      const buttonLabel = (cfg.button_boleto_label || "Receber boleto").slice(0, 25);
      const BOLETO_BTN_ID = "boleto_receber_doc";

      if (wantAudio) {
        const spoken = buildSpokenPreview(cfg.audio_script, nome);
        toast({
          title: "Gerando áudio Sofia…",
          description: "Em seguida: texto (se ligado) + apps + botão opcional.",
        });
        const blob = await generateMp3Blob(spoken);
        const file = new File([blob], `boleto-teste-${Date.now()}.mp3`, { type: "audio/mpeg" });
        const up = await uploadMedia(file, undefined, {
          scope: "admin",
          consultant_id: consultantId,
          kind: "audio",
          slug: "boleto-teste",
        });
        await whapiSendMedia(phone, up.url, "audio", undefined, "boleto-teste.mp3", {
          intent: "reply",
          customerId: cust?.id,
        });
      }

      if (wantText) {
        await whapiSendText(phone, stripBoletoButtonCta(waText), {
          intent: "reply",
          customerId: cust?.id,
        });
      }

      // Sempre: Android + iOS (botões Whapi; se falhar, lista *1.* / *2.* com links)
      try {
        await whapiSendButtons(
          phone,
          buildAppStoreButtonsPrompt(linkClub),
          boletoAppStoreChoiceOptions(),
          { intent: "reply", customerId: cust?.id },
        );
      } catch {
        await whapiSendText(phone, buildAppStoreNumberedMessage(linkClub), {
          intent: "reply",
          customerId: cust?.id,
        });
      }

      if (wantBoletoBtn) {
        const btnBody = buildBoletoButtonPrompt(buttonLabel);
        try {
          await whapiSendButtons(
            phone,
            btnBody,
            [{ id: BOLETO_BTN_ID, title: buttonLabel }],
            { intent: "reply", customerId: cust?.id },
          );
        } catch {
          await whapiSendText(phone, `${btnBody}\n\n*1.* ${buttonLabel}`, {
            intent: "reply",
            customerId: cust?.id,
          });
        }
        if (cust?.id && boleto.mes_referencia) {
          await supabase.from("customer_auto_message_log").upsert(
            {
              customer_id: cust.id,
              consultant_id: consultantId,
              stage_key: `boleto_chegou:${boleto.mes_referencia}`,
              status: "sent",
              customer_name: cust.name || nome,
              message_preview: "teste boleto chegou",
              remote_jid: `${phone}@s.whatsapp.net`,
            },
            { onConflict: "customer_id,stage_key" },
          );
        }
      }

      const parts = [
        wantAudio ? "áudio" : null,
        wantText ? "texto" : null,
        "apps",
        wantBoletoBtn ? "botão boleto" : null,
      ].filter(Boolean);
      toast({
        title: "Teste enviado",
        description: usedDemo
          ? `${formatBrazilPhone(phone)} · dados de exemplo · ${parts.join(" + ")}`
          : `${formatBrazilPhone(phone)} · ${boleto.mes_referencia || "?"} · ${parts.join(" + ")}`,
      });
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e || "");
      let description = toUserFacingError(e);
      if (
        /whapi|WhatsApp|boleto|send_buttons/i.test(raw) &&
        /Sessão expirou/i.test(description)
      ) {
        description = "Falha no envio pelo WhatsApp. Tente de novo em alguns segundos.";
      }
      toast({
        title: "Erro no teste",
        description,
        variant: "destructive",
      });
    } finally {
      setSendBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border bg-card p-4 space-y-4">
      <div>
        <h3 className="font-semibold text-sm">Automações iGreen</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Alertas já vêm ligados. Aviso de boleto no WhatsApp fica desligado por padrão —
          ligue só quando quiser avisar o cliente (app Club primeiro; arquivo só se pedir).
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
        </div>
      ) : (
        <div className="space-y-5">
          {GROUPS.map((g) => (
            <div key={g.title} className="space-y-2">
              <div>
                <p className="text-xs font-semibold text-foreground">{g.title}</p>
                <p className="text-[11px] text-muted-foreground">{g.hint}</p>
              </div>
              <div className="space-y-2">
                {g.items.map((it) => (
                  <div key={it.key} className="flex items-center justify-between gap-3 rounded-lg border bg-muted/20 p-2.5">
                    <div className="min-w-0">
                      <Label htmlFor={it.key} className="text-sm">{it.label}</Label>
                      <p className="text-[11px] text-muted-foreground">{it.desc}</p>
                    </div>
                    <Switch
                      id={it.key}
                      checked={!!settings?.[it.key]}
                      disabled={update.isPending}
                      onCheckedChange={(v) => onToggle(it.key, v)}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}

          <div className="space-y-2 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold">Textos, áudio e teste do aviso de boleto</p>
                <p className="text-[11px] text-muted-foreground">
                  Abertura fixa: {OLA_PREFIX_LABEL} · corpo editável abaixo · sem falar “PDF”
                </p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => setShowTexts((v) => !v)}>
                {showTexts ? "Fechar" : "Editar"}
              </Button>
            </div>

            {showTexts && (
              cfgLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Carregando textos…
                </div>
              ) : (
                <div className="space-y-3 pt-1">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Hora (BRT)</Label>
                      <Input
                        type="number"
                        min={0}
                        max={23}
                        value={cfg.cron_hour_brt}
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            cron_hour_brt: Math.max(0, Math.min(23, Number(e.target.value) || 0)),
                          }))
                        }
                      />
                    </div>
                    <div className="flex items-end gap-2 pb-1">
                      <Switch
                        id="cron_daily"
                        checked={!!cfg.cron_daily}
                        onCheckedChange={(v) => setDraft((d) => ({ ...d, cron_daily: v }))}
                      />
                      <Label htmlFor="cron_daily" className="text-xs">Todo dia (senão só dias úteis)</Label>
                    </div>
                  </div>

                  <div className="rounded-md border bg-muted/30 px-2.5 py-2 text-[11px] text-muted-foreground">
                    <span className="font-medium text-foreground">Abertura do áudio (fixa):</span>{" "}
                    {OLA_PREFIX_LABEL}
                    <span className="block mt-0.5">
                      O nome entra pela variável do cliente (igual cadência e ligação). Sem nome confiável, manda só o corpo.
                    </span>
                  </div>

                  <div>
                    <Label className="text-xs">Corpo do áudio (Sofia)</Label>
                    <Textarea
                      rows={4}
                      value={cfg.audio_script || DEFAULT_BOLETO_AUDIO_BODY}
                      onChange={(e) => setDraft((d) => ({ ...d, audio_script: e.target.value }))}
                    />
                  </div>

                  <div className="rounded-lg border border-dashed p-3 space-y-2 bg-muted/10">
                    <p className="text-xs font-semibold">Testar áudio e envio</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <Label className="text-xs">Nome no áudio</Label>
                        <Input
                          value={previewName}
                          onChange={(e) => setPreviewName(e.target.value)}
                          placeholder="Maria"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">WhatsApp de teste</Label>
                        <Input
                          value={testPhone}
                          onChange={(e) => setTestPhone(e.target.value)}
                          placeholder="34 99999-0000"
                        />
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={audioBusy}
                        onClick={() => void generateAndListen()}
                      >
                        {audioBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Volume2 className="h-4 w-4" />}
                        <span className="ml-1.5">Gerar e ouvir</span>
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        disabled={sendBusy || !testPhone.trim()}
                        onClick={() => void sendTest()}
                      >
                        {sendBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        <span className="ml-1.5">Enviar teste no Zap</span>
                      </Button>
                    </div>
                    {audioUrl && (
                      <audio ref={audioRef} controls src={audioUrl} className="w-full mt-1" />
                    )}
                    <p className="text-[11px] text-muted-foreground">
                      Respeita os toggles abaixo. Links Android/iOS vão sempre.
                      Sem boleto no cliente, usa mês/valor de exemplo só para o teste.
                    </p>
                  </div>

                  <div className="rounded-lg border p-3 space-y-2.5 bg-muted/10">
                    <p className="text-xs font-semibold">O que enviar</p>
                    <div className="flex items-center gap-2">
                      <Switch
                        id="send_audio"
                        checked={cfg.send_audio !== false}
                        onCheckedChange={(v) => setDraft((d) => ({ ...d, send_audio: v }))}
                      />
                      <Label htmlFor="send_audio" className="text-xs">Áudio Sofia</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        id="send_text"
                        checked={cfg.send_text !== false}
                        onCheckedChange={(v) => setDraft((d) => ({ ...d, send_text: v }))}
                      />
                      <Label htmlFor="send_text" className="text-xs">Texto / mensagem</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        id="button_enabled"
                        checked={cfg.button_enabled === true}
                        onCheckedChange={(v) => setDraft((d) => ({ ...d, button_enabled: v }))}
                      />
                      <Label htmlFor="button_enabled" className="text-xs">
                        Botão “Receber boleto” (arquivo no Zap)
                      </Label>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Apps Android e iPhone: <span className="font-medium text-foreground">sempre</span>
                      {" "}— botões no Whapi; no Evolution vira *1.* / *2.* com os links.
                    </p>
                    {cfg.button_enabled === true && (
                      <div>
                        <Label className="text-xs">Texto do botão (máx. 25)</Label>
                        <Input
                          maxLength={25}
                          value={cfg.button_boleto_label}
                          onChange={(e) =>
                            setDraft((d) => ({
                              ...d,
                              button_boleto_label: e.target.value.slice(0, 25),
                            }))
                          }
                        />
                      </div>
                    )}
                  </div>

                  <div>
                    <Label className="text-xs">Texto do WhatsApp</Label>
                    <Textarea
                      rows={8}
                      value={cfg.wa_text}
                      onChange={(e) => setDraft((d) => ({ ...d, wa_text: e.target.value }))}
                    />
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    disabled={updateCfg.isPending}
                    onClick={saveCfg}
                  >
                    {updateCfg.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar textos"}
                  </Button>
                </div>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}
