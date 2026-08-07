import { useEffect, useRef, useState } from "react";
import { Loader2, Volume2, Send, ImagePlus, X } from "lucide-react";
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
  isBoletoStatusPago,
  normalizeClubAccessEmail,
  normalizeBoletoImageUrl,
  renderBoletoAudioBody,
  resolveBoletoAudioConsultantVars,
  shouldSendBoletoImage,
  stripBoletoButtonCta,
  BOLETO_IMAGE_POSITION_LABELS,
  type BoletoImagePosition,
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

/** Espelha buildBoletoAudioSpoken da edge. */
function buildSpokenPreview(
  body: string,
  customerName: string,
  cons: {
    assistantName?: string | null;
    consultantName?: string | null;
    consultantDisplayName?: string | null;
    consultantGender?: string | null;
  },
): string {
  const vars = resolveBoletoAudioConsultantVars(cons);
  let corpus = renderBoletoAudioBody(body || DEFAULT_BOLETO_AUDIO_BODY, vars);
  corpus = corpus.replace(/^(Oi|Olá)([!,]\s*[^!]*)?!?\s*Tudo bem\?\s*/i, "").trim();
  const n = firstName(customerName);
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
  const [imageBusy, setImageBusy] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

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

  const loadConsAudioVars = async () => {
    const { data } = await supabase
      .from("consultants")
      .select("name, display_name, assistant_name, gender")
      .eq("id", consultantId)
      .maybeSingle();
    return {
      assistantName: data?.assistant_name ?? null,
      consultantName: data?.name ?? null,
      consultantDisplayName: data?.display_name ?? null,
      consultantGender: data?.gender ?? null,
    };
  };

  const pickImage = async (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({
        title: "Arquivo não é imagem",
        description: "Escolha um JPG, PNG ou WEBP.",
        variant: "destructive",
      });
      return;
    }
    setImageBusy(true);
    try {
      const up = await uploadMedia(file, undefined, {
        scope: "admin",
        consultant_id: consultantId,
        kind: "image",
        slug: "boleto-aviso",
      });
      const url = normalizeBoletoImageUrl(up.url);
      if (!url) throw new Error("O upload não devolveu um endereço https válido.");
      setDraft((d) => ({ ...d, image_url: url, send_image: true }));
      toast({
        title: "Imagem carregada",
        description: "Clique em “Salvar textos” para valer no envio.",
      });
    } catch (e) {
      toast({
        title: "Erro ao subir a imagem",
        description: toUserFacingError(e),
        variant: "destructive",
      });
    } finally {
      setImageBusy(false);
      if (imageInputRef.current) imageInputRef.current.value = "";
    }
  };

  const generateAndListen = async () => {
    setAudioBusy(true);
    try {
      const cons = await loadConsAudioVars();
      const spoken = buildSpokenPreview(cfg.audio_script, previewName, cons);
      const blob = await generateMp3Blob(spoken);
      if (audioUrl?.startsWith("blob:")) URL.revokeObjectURL(audioUrl);
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);
      requestAnimationFrame(() => {
        void audioRef.current?.play().catch(() => undefined);
      });
      toast({ title: "Áudio pronto", description: `${OLA_PREFIX_LABEL} + IA/consultor da sua conta.` });
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
        .select("id, name, igreen_code, phone_whatsapp, email")
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
        status: string | null;
      };
      const pickBoleto = async (customerOnly: boolean): Promise<BoletoRow[]> => {
        let q = supabase
          .from("igreen_customer_boletos")
          .select("url_boleto, total, vencimento, mes_referencia, nome, idcliente, customer_id, status")
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
      // Em produção o aviso nunca sai de boleto pago: no teste, preferir um em aberto.
      const emAberto = list.find((b) => !isBoletoStatusPago(b.status));
      const boleto: BoletoRow = emAberto || list[0] || {
        url_boleto: null,
        total: 189.9,
        vencimento: new Date(now.getFullYear(), now.getMonth(), 15).toISOString().slice(0, 10),
        mes_referencia: mesDemo,
        nome: cust?.name || previewName || "Maria",
        idcliente: Number(String(cust?.igreen_code || "").replace(/\D/g, "")) || null,
        customer_id: cust?.id || null,
        status: null,
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

      const emailAcesso = normalizeClubAccessEmail(cust?.email);

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
        email_acesso: emailAcesso || "",
        // Legado: textos antigos ainda podem ter {{link_club}}.
        link_club: emailAcesso || "",
        link_play: IGREEN_CLUB_PLAY_STORE_URL,
        link_appstore: IGREEN_CLUB_APP_STORE_URL,
        url_boleto: boleto.url_boleto || "",
      });
      const buttonLabel = (cfg.button_boleto_label || "Receber boleto").slice(0, 25);
      const BOLETO_BTN_ID = "boleto_receber_doc";

      const wantImage = shouldSendBoletoImage(cfg);
      let imageSent = false;
      const maybeSendImage = async (position: BoletoImagePosition) => {
        if (!wantImage || imageSent || cfg.image_position !== position) return;
        imageSent = true;
        const legenda = renderWaTemplate(cfg.image_caption || "", {
          saudacao,
          nome,
          mes: boleto.mes_referencia || "—",
          valor: formatValor(boleto.total),
          vencimento: formatVenc(boleto.vencimento),
          email_acesso: emailAcesso || "",
          link_club: emailAcesso || "",
          link_play: IGREEN_CLUB_PLAY_STORE_URL,
          link_appstore: IGREEN_CLUB_APP_STORE_URL,
          url_boleto: boleto.url_boleto || "",
        });
        await whapiSendMedia(
          phone,
          String(cfg.image_url),
          "image",
          legenda || undefined,
          undefined,
          { intent: "reply", customerId: cust?.id },
        );
      };

      await maybeSendImage("first");

      if (wantAudio) {
        const cons = await loadConsAudioVars();
        const spoken = buildSpokenPreview(cfg.audio_script, nome, cons);
        toast({
          title: "Gerando áudio…",
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

      await maybeSendImage("after_audio");

      if (wantText) {
        await whapiSendText(phone, stripBoletoButtonCta(waText), {
          intent: "reply",
          customerId: cust?.id,
        });
      }

      await maybeSendImage("after_text");

      // Sempre: Android + iOS (botões Whapi; se falhar, lista *1.* / *2.* com links)
      try {
        await whapiSendButtons(
          phone,
          buildAppStoreButtonsPrompt(emailAcesso),
          boletoAppStoreChoiceOptions(),
          { intent: "reply", customerId: cust?.id },
        );
      } catch {
        await whapiSendText(phone, buildAppStoreNumberedMessage(emailAcesso), {
          intent: "reply",
          customerId: cust?.id,
        });
      }

      await maybeSendImage("last");

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
                  Abertura: {OLA_PREFIX_LABEL} · IA = nome da sua assistente · consultor = você. Sem “PDF”.
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
                    <span className="font-medium text-foreground">Abertura (fixa):</span>{" "}
                    {OLA_PREFIX_LABEL}
                    <span className="block mt-0.5">
                      Variáveis do corpo: {"{{assistente}}"} (IA da conta), {"{{posse_consultor}}"}{" "}
                      (do Rafael / da Ana), {"{{chamar_consultor}}"}.
                    </span>
                  </div>

                  <div>
                    <Label className="text-xs">Corpo do áudio</Label>
                    <Textarea
                      rows={10}
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
                      Respeita os toggles abaixo (áudio, texto, imagem, botão). Links Android/iOS
                      vão sempre. Sem boleto no cliente, usa mês/valor de exemplo só para o teste.
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
                      <Label htmlFor="send_audio" className="text-xs">Áudio (IA do consultor)</Label>
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
                        id="send_image"
                        checked={cfg.send_image === true}
                        onCheckedChange={(v) => setDraft((d) => ({ ...d, send_image: v }))}
                      />
                      <Label htmlFor="send_image" className="text-xs">
                        Imagem (mensagem própria)
                      </Label>
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
                      <>
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
                        <div>
                          <Label className="text-xs">Legenda ao mandar o arquivo</Label>
                          <Textarea
                            rows={2}
                            value={cfg.doc_caption || ""}
                            onChange={(e) => setDraft((d) => ({ ...d, doc_caption: e.target.value }))}
                          />
                        </div>
                      </>
                    )}
                  </div>

                  {cfg.send_image === true && (
                    <div className="rounded-lg border p-3 space-y-2.5 bg-muted/10">
                      <p className="text-xs font-semibold">Imagem do aviso</p>

                      {cfg.image_url ? (
                        <div className="flex items-start gap-2.5">
                          <img
                            src={cfg.image_url}
                            alt="Imagem do aviso de boleto"
                            className="h-20 w-20 rounded-md border object-cover"
                          />
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => setDraft((d) => ({ ...d, image_url: null }))}
                          >
                            <X className="h-4 w-4" />
                            <span className="ml-1">Remover</span>
                          </Button>
                        </div>
                      ) : (
                        <p className="text-[11px] text-muted-foreground">
                          Nenhuma imagem escolhida — com o toggle ligado e sem imagem, o aviso sai
                          sem ela.
                        </p>
                      )}

                      <input
                        ref={imageInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => void pickImage(e.target.files?.[0] || null)}
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={imageBusy}
                        onClick={() => imageInputRef.current?.click()}
                      >
                        {imageBusy
                          ? <Loader2 className="h-4 w-4 animate-spin" />
                          : <ImagePlus className="h-4 w-4" />}
                        <span className="ml-1.5">
                          {cfg.image_url ? "Trocar imagem" : "Escolher imagem"}
                        </span>
                      </Button>

                      <div>
                        <Label className="text-xs">Ou cole o endereço da imagem (https)</Label>
                        <Input
                          value={cfg.image_url || ""}
                          placeholder="https://…"
                          onChange={(e) =>
                            setDraft((d) => ({ ...d, image_url: e.target.value.trim() || null }))
                          }
                        />
                      </div>

                      <div>
                        <Label className="text-xs">Legenda da imagem (opcional)</Label>
                        <Textarea
                          rows={3}
                          value={cfg.image_caption || ""}
                          placeholder="Seu boleto de {{mes}} chegou 💚"
                          onChange={(e) => setDraft((d) => ({ ...d, image_caption: e.target.value }))}
                        />
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          Aceita as mesmas variáveis do texto ({"{{nome}}"}, {"{{mes}}"},{" "}
                          {"{{valor}}"}, {"{{vencimento}}"}).
                        </p>
                      </div>

                      <div>
                        <Label className="text-xs">Quando enviar a imagem</Label>
                        <select
                          className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                          value={cfg.image_position || "first"}
                          onChange={(e) =>
                            setDraft((d) => ({
                              ...d,
                              image_position: e.target.value as BoletoImagePosition,
                            }))
                          }
                        >
                          {BOLETO_IMAGE_POSITION_LABELS.map((p) => (
                            <option key={p.value} value={p.value}>{p.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}

                  <div>
                    <Label className="text-xs">Texto do WhatsApp</Label>
                    <Textarea
                      rows={8}
                      value={cfg.wa_text}
                      onChange={(e) => setDraft((d) => ({ ...d, wa_text: e.target.value }))}
                    />
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Variáveis: {"{{saudacao}}"}, {"{{mes}}"}, {"{{valor}}"}, {"{{vencimento}}"},{" "}
                      {"{{email_acesso}}"} (e-mail de acesso do cliente no app). A mensagem dos
                      aplicativos já leva o acesso — sem link com o número do cliente.
                    </p>
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
