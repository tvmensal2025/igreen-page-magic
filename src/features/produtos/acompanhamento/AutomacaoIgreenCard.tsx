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
        desc: "Áudio + texto pedindo o app iGreen Club. Botão “Receber boleto” manda o arquivo no Zap. Desligado por padrão.",
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
    if (!draft) return;
    const patch = { ...draft };
    if (patch.button_boleto_label) {
      patch.button_boleto_label = String(patch.button_boleto_label).slice(0, 25);
    }
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

      // Preferir cliente desse WhatsApp — senão o clique “Receber boleto” não acha o boleto.
      const { data: cust } = await supabase
        .from("customers")
        .select("id, name, igreen_code, phone_whatsapp")
        .eq("consultant_id", consultantId)
        .or(phoneVariants.map((p) => `phone_whatsapp.eq.${p}`).join(","))
        .limit(1)
        .maybeSingle();

      let boletoQuery = supabase
        .from("igreen_customer_boletos")
        .select("url_boleto, total, vencimento, mes_referencia, nome, idcliente, customer_id")
        .eq("consultant_id", consultantId)
        .not("url_boleto", "is", null)
        .neq("url_boleto", "")
        .order("synced_at", { ascending: false })
        .limit(30);
      if (cust?.id) {
        boletoQuery = boletoQuery.eq("customer_id", cust.id);
      }
      const { data: boletos, error: bolErr } = await boletoQuery;
      if (bolErr) throw bolErr;
      const list = (boletos || []) as Array<{
        url_boleto: string;
        total: number | null;
        vencimento: string | null;
        mes_referencia: string | null;
        nome: string | null;
        idcliente: number | null;
        customer_id: string | null;
      }>;
      if (list.length === 0) {
        throw new Error(
          cust?.id
            ? "Esse número é cliente, mas sem boleto com link. Rode o sync de boletos."
            : "Nenhum boleto com link na carteira. Rode o sync de boletos antes.",
        );
      }
      const boleto = list[Math.floor(Math.random() * list.length)];
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
      // Texto com *negrito* WhatsApp + links das lojas (Android / iPhone).
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

      const spoken = buildSpokenPreview(cfg.audio_script, nome);
      toast({
        title: "Gerando áudio Sofia…",
        description: "Em seguida: texto formatado + botão (arquivo só no clique).",
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

      // 1) Texto formatado sozinho (*negrito* + links das lojas) — sem misturar botão.
      const bodyText = cfg.button_enabled ? stripBoletoButtonCta(waText) : waText;
      await whapiSendText(phone, bodyText, { intent: "reply", customerId: cust?.id });

      // 2) Botão em mensagem curta à parte (Whapi quick_reply). Se proxy antigo, cai em *1.*
      let buttonMode: "quick_reply" | "numbered_fallback" | "text_only" = "text_only";
      if (cfg.button_enabled) {
        const btnBody = buildBoletoButtonPrompt(buttonLabel);
        try {
          const btnRes = await whapiSendButtons(
            phone,
            btnBody,
            [{ id: BOLETO_BTN_ID, title: buttonLabel }],
            { intent: "reply", customerId: cust?.id },
          );
          buttonMode = btnRes.mode || "quick_reply";
        } catch (btnErr) {
          console.warn("[boleto-teste] botão Whapi:", btnErr);
          // Proxy sem send_buttons / canal sem interactive → lista numerada curta
          await whapiSendText(
            phone,
            `${btnBody}\n\n*1.* ${buttonLabel}`,
            { intent: "reply", customerId: cust?.id },
          );
          buttonMode = "numbered_fallback";
        }
      }

      // Armar clique: log do aviso → webhook manda o arquivo só quando apertar.
      let clickArmed = false;
      if (cust?.id && boleto.mes_referencia) {
        const stageKey = `boleto_chegou:${boleto.mes_referencia}`;
        const { error: logErr } = await supabase.from("customer_auto_message_log").upsert(
          {
            customer_id: cust.id,
            consultant_id: consultantId,
            stage_key: stageKey,
            status: "sent",
            customer_name: cust.name || nome,
            message_preview: "teste boleto chegou",
            remote_jid: `${phone}@s.whatsapp.net`,
          },
          { onConflict: "customer_id,stage_key" },
        );
        // RLS/permissão no log não deve abortar o teste (áudio+texto já foram).
        clickArmed = !logErr;
        if (logErr) {
          console.warn("[boleto-teste] log clique:", logErr.message || logErr);
        }
      }

      toast({
        title: "Teste enviado",
        description: clickArmed
          ? `${formatBrazilPhone(phone)} · ${boleto.mes_referencia || "?"} · toque em “${buttonLabel}” (ou digite 1) para o boleto`
          : `${formatBrazilPhone(phone)} · texto+lojas ok · para o clique mandar o arquivo, use WhatsApp de um cliente da carteira`,
      });
      if (buttonMode === "numbered_fallback") {
        toast({
          title: "Botão em modo número",
          description: "Digite 1 ou “Receber boleto” no Zap. (Botão visual depende do deploy do WhatsApp.)",
        });
      }
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e || "");
      let description = toUserFacingError(e);
      // Não assustar com “sessão” quando o proxy/WhatsApp recusou a ação.
      if (
        /Ação desconhecida|send_buttons|whapi|WhatsApp|interactive|boleto/i.test(raw) &&
        /Sessão expirou/i.test(description)
      ) {
        description = "Falha no envio pelo WhatsApp. Tente de novo em alguns segundos.";
      }
      if (/customer_auto_message_log|permission denied|row-level security/i.test(raw)) {
        description =
          "Texto pode ter sido enviado, mas não deu para armar o clique do boleto. Use um WhatsApp de cliente da carteira.";
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
                      Envia áudio + texto formatado (Play Store Android + App Store iPhone) com botão
                      “Receber boleto”. O arquivo só sai no clique/número. Use WhatsApp de cliente da carteira.
                    </p>
                  </div>

                  <div>
                    <Label className="text-xs">Texto do WhatsApp</Label>
                    <Textarea
                      rows={6}
                      value={cfg.wa_text}
                      onChange={(e) => setDraft((d) => ({ ...d, wa_text: e.target.value }))}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Botão (máx. 25)</Label>
                      <Input
                        maxLength={25}
                        value={cfg.button_boleto_label}
                        onChange={(e) =>
                          setDraft((d) => ({ ...d, button_boleto_label: e.target.value.slice(0, 25) }))
                        }
                      />
                    </div>
                    <div className="flex items-end gap-2 pb-1">
                      <Switch
                        id="button_enabled"
                        checked={!!cfg.button_enabled}
                        onCheckedChange={(v) => setDraft((d) => ({ ...d, button_enabled: v }))}
                      />
                      <Label htmlFor="button_enabled" className="text-xs">Mostrar botão “Receber boleto”</Label>
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Legenda ao enviar o boleto no Zap</Label>
                    <Textarea
                      rows={2}
                      value={cfg.doc_caption}
                      onChange={(e) => setDraft((d) => ({ ...d, doc_caption: e.target.value }))}
                    />
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    disabled={!draft || updateCfg.isPending}
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
