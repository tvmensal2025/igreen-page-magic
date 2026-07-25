import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ArrowRight, Bot, CalendarClock, Flame, Loader2, Megaphone,
  MessageSquare, Phone, RefreshCw, ShieldCheck, Sparkles, Zap,
} from "lucide-react";
import { CADENCE_GROUP_LABEL } from "@/lib/cadenceCalendarMap";

type BlockStatus = "off" | "on" | "partial";

type JourneyBlock = {
  id: "A" | "B" | "C" | "outros" | "carteira";
  emoji: string;
  titulo: string;
  subtitulo: string;
  paraQuem: string;
  status: BlockStatus;
  statusLabel: string;
  acoes: Array<{ label: string; to?: string; onClick?: () => void; variant?: "default" | "outline" | "ghost" }>;
  itens: string[];
};

interface Props {
  onGoTab?: (tab: string) => void;
  stats?: {
    pendingManual: number;
    posVendaUpcoming: number;
    botFollowups: number;
    bulkActive: number;
    timelineUpcoming: number;
  };
}

const ONDA_CURTA_KEYS = [
  "cadence_cold_1", "cadence_sms_1", "cadence_call_1", "cadence_cold_2",
  "cadence_sms_2", "cadence_call_2", "cadence_cold_3", "cadence_cold_4", "cadence_call_3",
] as const;

const RECALL_KEYS = [
  "cadence_recall_60d", "cadence_recall_90d", "cadence_recall_5m",
  "cadence_recall_8m", "cadence_recall_12m", "cadence_recall_yearly",
] as const;

/**
 * Mapa visual da plataforma — Grupo A, B, C e o resto.
 * Linguagem simples; nada fica de fora.
 */
export function AgendamentosJornadaMap({ onGoTab, stats }: Props) {
  const [loading, setLoading] = useState(true);
  const [engineOn, setEngineOn] = useState(false);
  const [ondaOn, setOndaOn] = useState(false);
  const [recallsOn, setRecallsOn] = useState(false);
  const [metaOn, setMetaOn] = useState(false);
  const [reheatOn, setReheatOn] = useState(false);
  const [reactivationOn, setReactivationOn] = useState(false);
  const [leadsNoMotor, setLeadsNoMotor] = useState(0);
  const [capToday, setCapToday] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const keys = [
      "cadence_engine", ...ONDA_CURTA_KEYS, ...RECALL_KEYS,
      "cadence_retarget_ads_15d", "facebook_retarget_sync",
      "daily_reheat", "reactivation_cron",
    ];
    const [{ data: settings }, { data: toggles }, { count }, capRes] = await Promise.all([
      supabase.from("app_settings").select("cadence_engine_enabled").eq("id", "global").maybeSingle(),
      supabase.from("automation_toggles").select("key, enabled").in("key", keys),
      supabase
        .from("lead_cadence_state")
        .select("id", { count: "exact", head: true })
        .not("stage", "in", "(WON,PAUSED,RETARGET_META)"),
      supabase.from("daily_reheat_settings").select("cap_b, cap_c, cap_global_outreach, daily_whapi_cap").eq("id", "global").maybeSingle(),
    ]);
    const tm = new Map((toggles || []).map((t) => [t.key, !!t.enabled]));
    const eng = !!settings?.cadence_engine_enabled && !!tm.get("cadence_engine");
    setEngineOn(eng);
    setOndaOn(eng && ONDA_CURTA_KEYS.every((k) => tm.get(k)));
    setRecallsOn(RECALL_KEYS.some((k) => tm.get(k)));
    setMetaOn(!!tm.get("facebook_retarget_sync") || !!tm.get("cadence_retarget_ads_15d"));
    setReheatOn(!!tm.get("daily_reheat"));
    setReactivationOn(!!tm.get("reactivation_cron"));
    setLeadsNoMotor(count ?? 0);
    const capB = Number(capRes.data?.cap_b ?? capRes.data?.daily_whapi_cap ?? 150);
    setCapToday(Number.isFinite(capB) ? capB : 150);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  function statusBadge(s: BlockStatus) {
    if (s === "on") return <Badge className="text-[10px]">Ligado</Badge>;
    if (s === "partial") return <Badge variant="secondary" className="text-[10px]">Parcial</Badge>;
    return <Badge variant="outline" className="text-[10px]">Desligado</Badge>;
  }

  const grupoBStatus: BlockStatus = ondaOn ? "on" : engineOn ? "partial" : "off";
  const grupoCStatus: BlockStatus = recallsOn || metaOn ? (recallsOn && metaOn ? "on" : "partial") : "off";

  const blocks: JourneyBlock[] = [
    {
      id: "A",
      emoji: "🔥",
      titulo: "Grupo A — Lead novo (quente)",
      subtitulo: "Quem manda mensagem agora e entra no cadastro",
      paraQuem: "Lead que acabou de falar no WhatsApp",
      status: "on",
      statusLabel: "Sempre ativo no chat",
      itens: [
        "Robô conversa, pede nome, conta, foto, documento",
        "Áudios da Sofia + botões no WhatsApp",
        "Não usa o motor de leads frios",
        "Textos: Voz → Multicanal → Grupo A",
      ],
      acoes: [
        { label: "Ver textos Grupo A", to: "/admin?tab=voz&sub=textos&cadenceGroup=A", variant: "outline" },
        { label: "Abrir chat", to: "/admin?tab=whatsapp", variant: "ghost" },
      ],
    },
    {
      id: "B",
      emoji: "❄️",
      titulo: "Grupo B — Lead frio (primeiros 10 dias)",
      subtitulo: "Quem parou de responder — onda WhatsApp, SMS e ligação",
      paraQuem: `Leads no motor (${leadsNoMotor} hoje) · máx. ${capToday ?? 60}/dia`,
      status: grupoBStatus,
      statusLabel: grupoBStatus === "on" ? "Envio ligado" : grupoBStatus === "partial" ? "Motor parcial" : "Desligado (seguro)",
      itens: [
        "Dia 1: WhatsApp → SMS → ligação (se ficar em silêncio)",
        "Dias 2, 4, 6, 7 e 10: mais toques programados",
        "Só DDD que você liberar (ex.: 34)",
        "Motor roda a cada 5 min quando ligado",
      ],
      acoes: [
        { label: "Ligar e separar leads", onClick: () => onGoTab?.("grupo-b"), variant: "default" },
        { label: "Ver textos Grupo B", to: "/admin?tab=voz&sub=textos&cadenceGroup=B", variant: "outline" },
        { label: "Tela técnica", to: "/admin/motor", variant: "ghost" },
      ],
    },
    {
      id: "C",
      emoji: "📅",
      titulo: "Grupo C — Longo prazo (meses depois)",
      subtitulo: "Meta + retornos 30d, 90d, 5m, 8m, 12m e anual",
      paraQuem: "Lead que terminou os 10 dias sem converter",
      status: grupoCStatus,
      statusLabel: grupoCStatus === "on" ? "Ligado" : "Desligado (recomendado no início)",
      itens: [
        "Após dia 10: vai para público Meta (sem WhatsApp)",
        "Recalls: WhatsApp → SMS → ligação em cada marco",
        "Zap = mesmo canal de origem do lead (WhatsApp)",
        "Conta no teto diário de frio (como o Grupo B)",
        "Ligue só depois de validar o Grupo B",
        "Textos: Voz → Multicanal → Grupo C",
      ],
      acoes: [
        { label: "Ver Grupo C", onClick: () => onGoTab?.("grupo-c"), variant: "outline" },
        { label: "Textos Grupo C", to: "/admin?tab=voz&sub=textos&cadenceGroup=C", variant: "ghost" },
        { label: "Meta Ads", to: "/admin/meta-ads", variant: "ghost" },
      ],
    },
    {
      id: "outros",
      emoji: "📬",
      titulo: "Outros envios automáticos",
      subtitulo: "Coisas que você agenda ou o sistema cutuca",
      paraQuem: "Leads e campanhas — não mistura com carteira",
      status: reactivationOn ? "partial" : "off",
      statusLabel: reactivationOn ? "Reaquecimento ligado" : "Maioria desligada",
      itens: [
        `Agenda manual: ${stats?.pendingManual ?? 0} pendente(s)`,
        `Pós-venda 30/60/90: ${stats?.posVendaUpcoming ?? 0} na fila`,
        `Reaquecimento: ${stats?.botFollowups ?? 0} continuação(ões)`,
        `Campanhas: ${stats?.bulkActive ?? 0} ativa(s)`,
        "Cutucar quem sumiu (6–48h), dia combinado, pós-FAQ",
      ],
      acoes: [
        { label: "Abrir agenda", onClick: () => onGoTab?.("agenda"), variant: "default" },
        { label: "Central admin", to: "/admin/agendamentos-central", variant: "ghost" },
      ],
    },
    {
      id: "carteira",
      emoji: "💚",
      titulo: "Carteira iGreen (cliente já aprovado)",
      subtitulo: "Pós-venda e alertas do escritório",
      paraQuem: "Só quem já é cliente — nunca lead frio",
      status: "on",
      statusLabel: "Captura sempre · envio com cuidado",
      itens: [
        "Boletos, devolutivas, telecom — sempre salvando",
        "Mensagens 30/60/90/120 dias após Aprovado",
        "Nunca recebe reaquecimento de lead",
      ],
      acoes: [
        { label: "Automações carteira", onClick: () => onGoTab?.("carteira"), variant: "outline" },
        { label: "Clientes ativos", to: "/admin?tab=crm-clientes", variant: "ghost" },
      ],
    },
  ];

  return (
    <div className="space-y-5">
      {/* Legenda rápida */}
      <div className="rounded-2xl border border-border/60 bg-muted/20 p-4">
        <p className="text-sm font-[Sora,ui-sans-serif] font-bold text-foreground mb-2">
          Como o sistema funciona (em uma frase)
        </p>
        <p className="text-[12px] text-muted-foreground leading-relaxed">
          <strong className="text-foreground">A</strong> = lead quente no chat ·{" "}
          <strong className="text-foreground">B</strong> = frio nos primeiros 10 dias ·{" "}
          <strong className="text-foreground">C</strong> = meses depois (Meta + recalls) ·{" "}
          <strong className="text-foreground">Carteira</strong> = cliente aprovado.
        </p>
        {reheatOn && engineOn && (
          <p className="text-[11px] text-warning mt-2 flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
            Atenção: ciclo diário (reheat) e motor de cadência estão ligados — pode cutucar 2×. Use só um.
          </p>
        )}
        <div className="flex flex-wrap gap-2 mt-3">
          <Button variant="ghost" size="sm" className="h-7 text-[11px] gap-1" disabled={loading} onClick={() => void load()}>
            <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} /> Atualizar status
          </Button>
        </div>
      </div>

      {/* Fluxo visual A → B → C */}
      <div className="hidden sm:flex items-center justify-center gap-2 text-[11px] text-muted-foreground py-1">
        <span className="font-medium text-foreground">🔥 A</span>
        <ArrowRight className="w-3 h-3" />
        <span>parou de responder</span>
        <ArrowRight className="w-3 h-3" />
        <span className="font-medium text-foreground">❄️ B (10 dias)</span>
        <ArrowRight className="w-3 h-3" />
        <span>sem conversão</span>
        <ArrowRight className="w-3 h-3" />
        <span className="font-medium text-foreground">📅 C (meses)</span>
      </div>

      {/* Cards por grupo */}
      <div className="grid gap-4 lg:grid-cols-2">
        {blocks.map((b) => (
          <article
            key={b.id}
            className={`rounded-2xl border p-4 space-y-3 transition-colors ${
              b.id === "B"
                ? "border-primary/30 bg-primary/5 lg:col-span-2"
                : "border-border/60 bg-card/50"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-lg leading-none mb-1">{b.emoji}</p>
                <h4 className="text-sm font-[Sora,ui-sans-serif] font-bold text-foreground">{b.titulo}</h4>
                <p className="text-[11px] text-muted-foreground mt-0.5">{b.subtitulo}</p>
              </div>
              {statusBadge(b.status)}
            </div>
            <p className="text-[11px] text-muted-foreground">
              <span className="font-medium text-foreground">Para quem:</span> {b.paraQuem}
            </p>
            <p className="text-[10px] text-muted-foreground italic">{b.statusLabel}</p>
            <ul className="text-[11px] text-muted-foreground space-y-1 list-disc pl-4">
              {b.itens.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2 pt-1">
              {b.acoes.map((a) =>
                a.to ? (
                  <Button key={a.label} asChild size="sm" variant={a.variant || "outline"} className="rounded-xl text-[11px] h-8">
                    <Link to={a.to}>{a.label}</Link>
                  </Button>
                ) : (
                  <Button
                    key={a.label}
                    size="sm"
                    variant={a.variant || "outline"}
                    className="rounded-xl text-[11px] h-8"
                    onClick={a.onClick}
                  >
                    {a.label}
                  </Button>
                ),
              )}
            </div>
          </article>
        ))}
      </div>

      {/* Referência técnica colapsada */}
      <details className="rounded-xl border border-dashed border-border/60 p-3 text-[11px] text-muted-foreground">
        <summary className="cursor-pointer font-medium text-foreground">Nomes técnicos (só se precisar)</summary>
        <div className="mt-2 space-y-1 font-mono text-[10px]">
          <p>{CADENCE_GROUP_LABEL.A} → bot-flow, fluxo-b-ai</p>
          <p>{CADENCE_GROUP_LABEL.B} → cadence-tick, lead_cadence_state</p>
          <p>{CADENCE_GROUP_LABEL.C} → facebook_retarget_sync, RECALL_*</p>
          <p>Paralelo legado → daily_reheat (não ligar junto com motor)</p>
        </div>
      </details>
    </div>
  );
}

/** Ícones para chips da timeline */
export function jornadaKindIcon(kind: string) {
  switch (kind) {
    case "manual_scheduled": return <CalendarClock className="w-3.5 h-3.5" />;
    case "pos_venda_auto": return <Sparkles className="w-3.5 h-3.5" />;
    case "bot_followup": return <Bot className="w-3.5 h-3.5" />;
    case "bulk_campaign": return <Megaphone className="w-3.5 h-3.5" />;
    case "voice_campaign": return <Phone className="w-3.5 h-3.5" />;
    default: return <MessageSquare className="w-3.5 h-3.5" />;
  }
}
