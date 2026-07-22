import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Search,
  UserPlus,
  RefreshCw,
  CheckSquare,
  X,
  ChevronDown,
  ChevronRight,
  PanelLeftClose,
  Clock,
  CheckCheck,
  LogOut,
  Loader2,
  MessageCirclePlus,
  Megaphone,
  MessageCircle,
} from "lucide-react";

import { Input } from "@/components/ui/input";
import { CAPTURE_FIELDS } from "@/hooks/useCaptureSession";
import { usePrompt } from "@/components/ui/prompt-dialog";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { toast } from "sonner";
import { ScheduleCallButton } from "@/components/voz/ScheduleCallButton";
import { VirtualList } from "@/components/ui/VirtualList";
import { hasValidBatchPhone } from "@/components/captacao/runAttendanceBatch";
import { CloseAttendanceBatchDialog } from "@/components/captacao/CloseAttendanceBatchDialog";
import {
  LeadOriginEditorDialog,
  type LeadOriginSaved,
} from "@/components/leads/LeadOriginEditorDialog";
import { CustomerTagsEditor } from "@/components/leads/CustomerTagsEditor";
import {
  loadCustomerTagsBatch,
  phoneToRemoteJid,
  type CustomerTag,
} from "@/hooks/useCustomerTags";
import { isValidBrNationalPhone, toWhatsappCanonical } from "@/lib/captacao/portalPhone";
import { stripWhatsAppMarkup } from "@/lib/whatsapp/formatWhatsAppText";
import { isCrmCadastroEmAnalise, isNuncaMaisContatar } from "@/lib/crmVsLeadAnalysis";

export type CapturePeriodKey = "48h" | "7d" | "30d" | "60d" | "90d" | "all";

export interface CaptureBatchLead {
  id: string;
  name: string | null;
  phone_whatsapp: string | null;
  capture_started_at: string | null;
  created_at: string;
  welcome_sent_at: string | null;
  attendance_rating_requested_at: string | null;
  filled: number;
  lastMsg?: string | null;
  lastMsgAt?: string | null;
  partnerId?: string | null;
  partnerName?: string | null;
  campaignId?: string | null;
  campaignName?: string | null;
  /** Primeiro campo faltante da ficha Energia (label curto). */
  nextMissingLabel?: string | null;
  /** Cadastro já enviado ao iGreen / passo CRM. */
  cadastroEmAnalise?: boolean;
  conversationStep?: string | null;
  doNotContact?: boolean;
  botPaused?: boolean;
  /** Veio de campanha Meta (source_campaign_id / ctwa / lead_source). */
  fromCampaign?: boolean;
}

type OriginTab = "all" | "campanha" | "mensagem";

/** Campanha Meta/CTWA vs mensagem orgânica qualquer. */
function isFromCampaign(c: {
  source_campaign_id?: string | null;
  ctwa_clid?: string | null;
  lead_source?: unknown;
}): boolean {
  if (c.source_campaign_id) return true;
  if (c.ctwa_clid) return true;
  const raw = c.lead_source;
  const src =
    typeof raw === "string"
      ? raw
      : raw && typeof raw === "object" && "source" in (raw as object)
        ? String((raw as { source?: unknown }).source || "")
        : "";
  const s = src.toLowerCase();
  return s === "meta_ads" || s === "ctwa" || s === "facebook" || s === "instagram" || s === "meta";
}

interface Props {
  consultantId: string;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  gameOn?: boolean;
  whatsappConnected?: boolean;
  onOpenBatch?: (leads: CaptureBatchLead[], periodLabel: string) => void;
  onCollapseList?: () => void;
}


const PERIOD_OPTIONS: { key: CapturePeriodKey; label: string; ms: number | null }[] = [
  { key: "48h", label: "48h", ms: 48 * 60 * 60 * 1000 },
  { key: "7d", label: "7d", ms: 7 * 24 * 60 * 60 * 1000 },
  { key: "30d", label: "30d", ms: 30 * 24 * 60 * 60 * 1000 },
  { key: "60d", label: "60d", ms: 60 * 24 * 60 * 60 * 1000 },
  { key: "90d", label: "90d", ms: 90 * 24 * 60 * 60 * 1000 },
  { key: "all", label: "Todos", ms: null },
];

export function periodLabelOf(key: CapturePeriodKey): string {
  if (key === "48h") return "últimas 48h";
  if (key === "all") return "todos os períodos";
  const opt = PERIOD_OPTIONS.find((o) => o.key === key);
  return opt ? `últimos ${opt.label}` : key;
}

const AVATAR_TONES = [
  "bg-primary/15 text-primary",
  "bg-info/15 text-info",
  "bg-warning/15 text-warning",
  "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
];
function toneFor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}
function initialsFrom(name: string | null, phone: string | null) {
  const src = (name || "").trim();
  if (src) {
    const parts = src.split(/\s+/);
    return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || "?";
  }
  return (phone || "?").replace(/\D/g, "").slice(-2) || "?";
}

/** Âncora de atividade: prioriza última mensagem, cai pra início de captação/created. */
function activityAnchor(l: CaptureBatchLead): number {
  const candidates = [l.lastMsgAt, l.capture_started_at, l.created_at];
  let best = 0;
  for (const iso of candidates) {
    if (!iso) continue;
    const t = new Date(iso).getTime();
    if (Number.isFinite(t) && t > best) best = t;
  }
  return best;
}

function sortByActivity(rows: CaptureBatchLead[]): CaptureBatchLead[] {
  return [...rows].sort((a, b) => activityAnchor(b) - activityAnchor(a));
}

/** Atendimento ativo = welcome enviado e pesquisa ainda não pedida. */
function isInAttendance(l: CaptureBatchLead): boolean {
  return !!l.welcome_sent_at && !l.attendance_rating_requested_at;
}

function firstMissingCaptureLabel(c: Record<string, unknown>): string | null {
  for (const f of CAPTURE_FIELDS) {
    const v = c[f.key];
    if (v === null || v === undefined) return f.label;
    if (typeof v === "string" && !v.trim()) return f.label;
    if (f.key === "electricity_bill_value" && Number(v) <= 0) return f.label;
  }
  return null;
}

function previewMessageText(raw: string | null | undefined, messageType?: string | null): string {
  const t = (raw || "").trim();
  if (!t) return messageType ? `[${messageType}]` : "";
  return stripWhatsAppMarkup(t) || t;
}

async function fetchLastMessagesByCustomer(
  ids: string[],
): Promise<Map<string, { text: string; at: string }>> {
  const lastByCustomer = new Map<string, { text: string; at: string }>();
  const CHUNK = 80;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const { data: msgs } = await supabase
      .from("conversations")
      .select("customer_id, message_text, message_type, created_at")
      .in("customer_id", slice)
      .order("created_at", { ascending: false })
      .limit(Math.min(400, slice.length * 3));
    for (const m of (msgs as any[]) || []) {
      if (!lastByCustomer.has(m.customer_id)) {
        const t = previewMessageText(m.message_text, m.message_type);
        lastByCustomer.set(m.customer_id, { text: t, at: m.created_at });
      }
    }
  }
  return lastByCustomer;
}

/** Conta inbound após last_seen — alinha badge Captação com “não lidas reais”. */
async function fetchUnreadInboundCounts(
  ids: string[],
  selectedId: string | null,
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const CHUNK = 60;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const { data: msgs } = await supabase
      .from("conversations")
      .select("customer_id, created_at, message_direction, message_text")
      .in("customer_id", slice)
      .eq("message_direction", "inbound")
      .order("created_at", { ascending: false })
      .limit(Math.min(500, slice.length * 15));
    for (const m of (msgs as any[]) || []) {
      const cid = m.customer_id as string;
      if (!cid || cid === selectedId) continue;
      const txt = typeof m.message_text === "string" ? m.message_text : "";
      if (
        txt.startsWith("[__safety_ping__]") ||
        txt.startsWith("[inline-sent]") ||
        txt.startsWith("[failed:")
      ) continue;
      const seen = readLastSeen(cid);
      const ts = new Date(m.created_at).getTime();
      if (!Number.isFinite(ts) || ts <= seen) continue;
      counts[cid] = (counts[cid] || 0) + 1;
    }
  }
  return counts;
}

const LAST_SEEN_KEY = (id: string) => `cap_last_seen_${id}`;
function readLastSeen(id: string): number {
  try {
    const v = localStorage.getItem(LAST_SEEN_KEY(id));
    return v ? Number(v) || 0 : 0;
  } catch {
    return 0;
  }
}
function writeLastSeen(id: string, ts: number) {
  try {
    localStorage.setItem(LAST_SEEN_KEY(id), String(ts));
  } catch {}
}

export function CaptureLeadList({
  consultantId,
  selectedId,
  onSelect,
  whatsappConnected = false,
  onOpenBatch,
  onCollapseList,
}: Props) {

  const prompt = usePrompt();
  const confirm = useConfirm();
  const [leads, setLeads] = useState<CaptureBatchLead[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [period, setPeriod] = useState<CapturePeriodKey>("60d");
  const [closeBatchOpen, setCloseBatchOpen] = useState(false);
  const [closeBatchLeads, setCloseBatchLeads] = useState<CaptureBatchLead[]>([]);
  /** unread por lead (client-side, apoiado em localStorage cap_last_seen_*) */
  const [unread, setUnread] = useState<Record<string, number>>({});
  /** flag para “piscar” a borda do card quando entra msg nova */
  const [flash, setFlash] = useState<Record<string, number>>({});
  const [tagsByJid, setTagsByJid] = useState<Map<string, CustomerTag[]>>(new Map());
  const [originLead, setOriginLead] = useState<CaptureBatchLead | null>(null);
  const [originTab, setOriginTab] = useState<OriginTab>(() => {
    try {
      const v = localStorage.getItem("cap_origin_tab");
      if (v === "campanha" || v === "mensagem" || v === "all") return v;
    } catch {}
    return "all";
  });
  const [showNewChat, setShowNewChat] = useState(false);
  const [newPhone, setNewPhone] = useState("");
  const [startingByPhone, setStartingByPhone] = useState(false);
  const newPhoneRef = useRef<HTMLInputElement>(null);
  const loadSeqRef = useRef(0);
  const selectedRef = useRef<string | null>(selectedId);
  useEffect(() => {
    selectedRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    try { localStorage.setItem("cap_origin_tab", originTab); } catch {}
  }, [originTab]);

  useEffect(() => {
    if (showNewChat) {
      const t = window.setTimeout(() => newPhoneRef.current?.focus(), 80);
      return () => window.clearTimeout(t);
    }
  }, [showNewChat]);

  const reloadTags = useCallback(async () => {
    const jids = leads
      .map((r) => phoneToRemoteJid(r.phone_whatsapp))
      .filter((j): j is string => !!j);
    const map = await loadCustomerTagsBatch(consultantId, jids);
    setTagsByJid(map);
  }, [leads, consultantId]);

  const applyOriginSaved = useCallback((leadId: string, saved: LeadOriginSaved) => {
    setLeads((prev) =>
      prev.map((l) =>
        l.id === leadId
          ? {
              ...l,
              partnerId: saved.referral_partner_id,
              partnerName: saved.partner_name,
              campaignId: saved.source_campaign_id,
              campaignName: saved.campaign_name,
            }
          : l,
      ),
    );
  }, []);

  const load = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    setLoading(true);
    try {
      const cols =
        "id, name, phone_whatsapp, capture_started_at, created_at, welcome_sent_at, attendance_rating_requested_at, igreen_code, assinatura_cliente, referral_partner_id, source_campaign_id, ctwa_clid, lead_source, portal_submitted_at, conversation_step, do_not_contact, bot_paused, " +
        CAPTURE_FIELDS.map((f) => f.key).join(", ");
      // Traz manual (Captação) + auto sem welcome (leads novos "Em espera"),
      // sempre respeitando: não fechado, não virou cliente iGreen.
      // Bloqueados / cadastro em análise saem no filtro client-side abaixo.
      const { data, error } = await supabase
        .from("customers")
        .select(cols)
        .eq("consultant_id", consultantId)
        .is("capture_closed_at", null)
        .is("igreen_code", null)
        .is("assinatura_cliente", null)
        .or("capture_mode.eq.manual,welcome_sent_at.is.null")
        .order("created_at", { ascending: false })
        .limit(400);
      if (seq !== loadSeqRef.current) return;
      if (error) {
        toast.error("Falha ao carregar conversas");
        setLeads([]);
        setLoading(false);
        return;
      }
      const rawIds = (data || []).map((c: any) => c.id);
      let closedElsewhere = new Set<string>();
      if (rawIds.length) {
        const { data: closedSales } = await supabase
          .from("sales")
          .select("customer_id")
          .in("customer_id", rawIds)
          .not("outcome", "is", null);
        closedElsewhere = new Set((closedSales || []).map((s: any) => s.customer_id));
      }
      const filtered = (data || []).filter((c: any) => {
        if (closedElsewhere.has(c.id)) return false;
        // Fora da Captação: bloqueado e cadastro já na esteira iGreen (CRM).
        if (
          isNuncaMaisContatar({
            do_not_contact: c.do_not_contact,
          })
        ) {
          return false;
        }
        if (
          isCrmCadastroEmAnalise({
            portal_submitted_at: c.portal_submitted_at,
            conversation_step: c.conversation_step,
          })
        ) {
          return false;
        }
        return true;
      });

      // Enriquecimento com nomes de parceiro/campanha (bulk)
      const partnerIds = Array.from(
        new Set(filtered.map((c: any) => c.referral_partner_id).filter(Boolean)),
      ) as string[];
      const campaignIds = Array.from(
        new Set(filtered.map((c: any) => c.source_campaign_id).filter(Boolean)),
      ) as string[];
      const [partnersRes, campaignsRes] = await Promise.all([
        partnerIds.length
          ? supabase.from("referral_partners").select("id, nome").in("id", partnerIds)
          : Promise.resolve({ data: [] as any[] }),
        campaignIds.length
          ? supabase.from("facebook_campaigns").select("id, name").in("id", campaignIds)
          : Promise.resolve({ data: [] as any[] }),
      ]);
      const partnerMap = new Map<string, string>();
      for (const p of ((partnersRes as any).data || []) as any[]) partnerMap.set(p.id, p.nome);
      const campaignMap = new Map<string, string>();
      for (const c of ((campaignsRes as any).data || []) as any[]) campaignMap.set(c.id, c.name);

      const rows: CaptureBatchLead[] = filtered.map((c: any) => ({
        id: c.id,
        name: c.name,
        phone_whatsapp: c.phone_whatsapp,
        capture_started_at: c.capture_started_at,
        created_at: c.created_at,
        welcome_sent_at: c.welcome_sent_at ?? null,
        attendance_rating_requested_at: c.attendance_rating_requested_at ?? null,
        filled: CAPTURE_FIELDS.filter((f) => {
          const v = c[f.key];
          if (v === null || v === undefined) return false;
          if (typeof v === "string" && !v.trim()) return false;
          if (f.key === "electricity_bill_value" && Number(v) <= 0) return false;
          return true;
        }).length,
        partnerId: c.referral_partner_id ?? null,
        partnerName: c.referral_partner_id ? partnerMap.get(c.referral_partner_id) ?? null : null,
        campaignId: c.source_campaign_id ?? null,
        campaignName: c.source_campaign_id ? campaignMap.get(c.source_campaign_id) ?? null : null,
        nextMissingLabel: firstMissingCaptureLabel(c),
        cadastroEmAnalise: false,
        conversationStep: c.conversation_step ?? null,
        doNotContact: false,
        botPaused: !!c.bot_paused,
        fromCampaign: isFromCampaign(c),
      }));
      setLeads(sortByActivity(rows));
      setLoading(false);

      const jids = rows
        .map((r) => phoneToRemoteJid(r.phone_whatsapp))
        .filter((j): j is string => !!j);
      void loadCustomerTagsBatch(consultantId, jids).then((map) => {
        if (seq !== loadSeqRef.current) return;
        setTagsByJid(map);
      });

      const ids = rows.map((r) => r.id);
      if (ids.length === 0) return;
      const lastByCustomer = await fetchLastMessagesByCustomer(ids);
      if (seq !== loadSeqRef.current) return;
      setLeads((prev) => {
        const merged = prev.map((r) => {
          const last = lastByCustomer.get(r.id);
          return last ? { ...r, lastMsg: last.text, lastMsgAt: last.at } : r;
        });
        return sortByActivity(merged);
      });
      const unreadCounts = await fetchUnreadInboundCounts(ids, selectedRef.current);
      if (seq !== loadSeqRef.current) return;
      setUnread(unreadCounts);
    } catch {
      if (seq !== loadSeqRef.current) return;
      toast.error("Falha ao carregar conversas");
      setLoading(false);
    }
  }, [consultantId]);

  useEffect(() => {
    void load();
  }, [consultantId, load]);

  useEffect(() => {
    const onBatchDone = () => void load();
    window.addEventListener("captacao:batch-finished", onBatchDone);
    return () => window.removeEventListener("captacao:batch-finished", onBatchDone);
  }, [consultantId, load]);

  // Realtime — customers do consultor (debounce: evita reload completo a cada UPDATE)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const ch = supabase
      .channel(`capture-list-${consultantId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "customers", filter: `consultant_id=eq.${consultantId}` },
        () => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => { void load(); }, 1500);
        },
      )
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(ch);
    };
  }, [consultantId, load]);

  // Remoção otimista: quando "Encerrar captação" fecha um lead, some da lista na hora
  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent<{ id?: string }>).detail?.id;
      if (!id) return;
      setLeads((prev) => prev.filter((l) => l.id !== id));
      setUnread((prev) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
    };
    window.addEventListener("captacao:lead-closed", handler as EventListener);
    return () => window.removeEventListener("captacao:lead-closed", handler as EventListener);
  }, []);

  // Realtime — mensagens do consultor (bubbles leads para o topo + unread)
  useEffect(() => {
    const ch = supabase
      .channel(`capture-conv-${consultantId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "conversations", filter: `consultant_id=eq.${consultantId}` },
        (payload) => {
          const row = payload.new as {
            customer_id: string;
            message_direction: string;
            message_text: string | null;
            message_type: string | null;
            created_at: string;
          };
          if (!row?.customer_id) return;
          const txt = previewMessageText(row.message_text, row.message_type);
          // Filtra sentinels internos
          if (typeof row.message_text === "string" && (
            row.message_text.startsWith("[__safety_ping__]") ||
            row.message_text.startsWith("[inline-sent]") ||
            row.message_text.startsWith("[failed:")
          )) return;

          setLeads((prev) => {
            const idx = prev.findIndex((l) => l.id === row.customer_id);
            if (idx === -1) {
              // Lead ainda não está na lista — recarrega para trazer.
              void load();
              return prev;
            }
            const updated = { ...prev[idx], lastMsg: txt, lastMsgAt: row.created_at };
            const next = [...prev];
            next[idx] = updated;
            return sortByActivity(next);
          });

          if (row.message_direction === "inbound" && row.customer_id !== selectedRef.current) {
            setUnread((prev) => ({ ...prev, [row.customer_id]: (prev[row.customer_id] || 0) + 1 }));
            setFlash((prev) => ({ ...prev, [row.customer_id]: Date.now() }));
            // toast discreto — se doc não estiver visível, o browser ainda mostra a badge
            toast("Nova mensagem", { description: txt.slice(0, 80) });
            // ping sonoro leve, respeitando visibilidade
            try {
              if (document.visibilityState !== "visible") {
                const audio = new Audio("data:audio/wav;base64,UklGRhwAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=");
                void audio.play().catch(() => {});
              }
            } catch {}
          }
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [consultantId, load]);

  // Zera unread + registra last_seen quando um lead é selecionado
  useEffect(() => {
    if (!selectedId) return;
    writeLastSeen(selectedId, Date.now());
    setUnread((prev) => {
      if (!prev[selectedId]) return prev;
      const { [selectedId]: _drop, ...rest } = prev;
      return rest;
    });
  }, [selectedId]);

  const periodMs = PERIOD_OPTIONS.find((o) => o.key === period)?.ms ?? null;
  const deferredQ = useDeferredValue(q);

  const periodFiltered = useMemo(() => {
    const now = Date.now();
    return leads.filter((l) => {
      if (periodMs != null) {
        const anchor = activityAnchor(l);
        if (!anchor || now - anchor > periodMs) return false;
      }
      if (!deferredQ) return true;
      const s = deferredQ.toLowerCase();
      return (l.name || "").toLowerCase().includes(s) || (l.phone_whatsapp || "").includes(s);
    });
  }, [leads, deferredQ, periodMs]);

  const filtered = useMemo(() => {
    return periodFiltered.filter((l) => {
      if (originTab === "campanha" && !l.fromCampaign) return false;
      if (originTab === "mensagem" && l.fromCampaign) return false;
      return true;
    });
  }, [periodFiltered, originTab]);

  // Se o lead selecionado saiu da Captação (bloqueado / CRM / filtro), limpa.
  useEffect(() => {
    if (!selectedId) return;
    if (leads.some((l) => l.id === selectedId)) return;
    onSelect(null);
  }, [leads, selectedId, onSelect]);

  const originCounts = useMemo(() => {
    let campanha = 0;
    let mensagem = 0;
    for (const l of periodFiltered) {
      if (l.fromCampaign) campanha++;
      else mensagem++;
    }
    return { all: periodFiltered.length, campanha, mensagem };
  }, [periodFiltered]);

  const filteredIds = useMemo(() => new Set(filtered.map((l) => l.id)), [filtered]);

  const emAtendimento = useMemo(() => filtered.filter((l) => !!l.welcome_sent_at && !l.attendance_rating_requested_at), [filtered]);
  const emEspera = useMemo(() => filtered.filter((l) => !l.welcome_sent_at || !!l.attendance_rating_requested_at), [filtered]);


  const [activeTab, setActiveTab] = useState<"atendimento" | "espera">(() => {
    try {
      const v = localStorage.getItem("cap_active_tab");
      return v === "espera" ? "espera" : "atendimento";
    } catch { return "atendimento"; }
  });
  useEffect(() => {
    try { localStorage.setItem("cap_active_tab", activeTab); } catch {}
  }, [activeTab]);

  const startByPhone = useCallback(async (rawPhone: string) => {
    const digits = toWhatsappCanonical(rawPhone);
    if (!isValidBrNationalPhone(digits) || digits.length < 12 || digits.length > 13) {
      toast.error("Telefone inválido — use DDD + celular");
      return;
    }
    setStartingByPhone(true);
    try {
      const { data: existing } = await supabase
        .from("customers")
        .select("id, do_not_contact, portal_submitted_at, conversation_step, capture_closed_at, igreen_code, assinatura_cliente")
        .eq("consultant_id", consultantId)
        .eq("phone_whatsapp", digits)
        .maybeSingle();

      if (existing?.id) {
        if (existing.do_not_contact) {
          toast.error("Este número está bloqueado (nunca mais contatar)");
          return;
        }
        if (
          isCrmCadastroEmAnalise({
            portal_submitted_at: existing.portal_submitted_at,
            conversation_step: existing.conversation_step,
          })
        ) {
          toast.error("Cadastro já enviado — acompanhe no CRM, não na Captação");
          return;
        }
        if (existing.capture_closed_at || existing.igreen_code || existing.assinatura_cliente) {
          toast.error("Este cliente já saiu da Captação");
          return;
        }
        await supabase
          .from("customers")
          .update({ capture_mode: "manual", capture_started_at: new Date().toISOString() })
          .eq("id", existing.id);
        onSelect(existing.id);
        toast.success("Conversa aberta na Captação");
      } else {
        const { data: created, error } = await supabase
          .from("customers")
          .insert({
            consultant_id: consultantId,
            phone_whatsapp: digits,
            capture_mode: "manual",
            capture_started_at: new Date().toISOString(),
            customer_origin: "whatsapp_lead",
          })
          .select("id")
          .maybeSingle();
        if (error || !created?.id) {
          toast.error(error?.message || "Não consegui criar o lead");
          return;
        }
        onSelect(created.id);
        toast.success("Nova conversa criada");
      }
      setShowNewChat(false);
      setNewPhone("");
      void load();
    } finally {
      setStartingByPhone(false);
    }
  }, [consultantId, onSelect, load]);

  const unreadByTab = useMemo(() => {
    let atend = 0, esp = 0;
    for (const l of filtered) {
      const n = unread[l.id] || 0;
      if (n <= 0) continue;
      if (l.welcome_sent_at && !l.attendance_rating_requested_at) atend += n; else esp += n;
    }
    return { atend, esp };
  }, [filtered, unread]);

  const unreadTotal = unreadByTab.atend + unreadByTab.esp;

  const activeToday = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    let n = 0;
    for (const l of filtered) {
      const t = l.lastMsgAt ? new Date(l.lastMsgAt).getTime() : 0;
      if (t >= start) n++;
    }
    return n;
  }, [filtered]);

  const markAllRead = () => {
    const now = Date.now();
    for (const id of filteredIds) writeLastSeen(id, now);
    setUnread({});
    toast.success("Marcado como lido");
  };

  const markUnread = useCallback((id: string) => {
    writeLastSeen(id, 0);
    setUnread((prev) => ({ ...prev, [id]: Math.max(1, prev[id] || 0) }));
  }, []);



  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (filteredIds.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [filteredIds]);

  const selectedVisibleCount = useMemo(() => {
    let n = 0;
    for (const id of selectedIds) if (filteredIds.has(id)) n++;
    return n;
  }, [selectedIds, filteredIds]);

  const fmtTime = (iso: string | null) => {
    if (!iso) return "";
    const d = new Date(iso);
    const mins = Math.floor((Date.now() - d.getTime()) / 60000);
    if (mins < 1) return "agora";
    if (mins < 60) return `${mins}m`;
    if (mins < 1440) return `${Math.floor(mins / 60)}h`;
    return `${Math.floor(mins / 1440)}d`;
  };

  const fmtPhone = (p: string | null) => {
    if (!p) return "—";
    if (/sem_celular/i.test(p)) return "Sem telefone";
    const d = p.replace(/\D/g, "");
    return d.length >= 12 ? `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}` : p;
  };

  const toggleSelectMode = () => {
    setSelectMode((v) => {
      // Entra e sai sempre com seleção vazia — usuário marca 1 a 1.
      setSelectedIds(new Set());
      return !v;
    });
  };

  const toggleId = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllFiltered = () => {
    setSelectedIds(new Set(filtered.map((l) => l.id)));
  };

  const selectAllOnTab = () => {
    const tabLeads = activeTab === "atendimento" ? emAtendimento : emEspera;
    setSelectedIds(new Set(tabLeads.map((l) => l.id)));
  };

  const selectWithoutAttendance = () => {
    setSelectedIds(new Set(filtered.filter((l) => !l.welcome_sent_at || !!l.attendance_rating_requested_at).map((l) => l.id)));
  };

  const clearSelection = () => setSelectedIds(new Set());

  const tabSelectableCount = activeTab === "atendimento" ? emAtendimento.length : emEspera.length;
  const allOnTabSelected =
    tabSelectableCount > 0 &&
    (activeTab === "atendimento" ? emAtendimento : emEspera).every((l) => selectedIds.has(l.id));

  const openBatch = () => {
    if (!onOpenBatch) return;
    if (!whatsappConnected) {
      toast.error("WhatsApp desconectado — reconecte para abrir em lote");
      return;
    }
    const picked = filtered.filter((l) => selectedIds.has(l.id));
    if (picked.length === 0) {
      toast.error("Selecione pelo menos um cliente");
      return;
    }
    onOpenBatch(picked, periodLabelOf(period));
  };

  /** Todos em atendimento na lista carregada (independente do filtro de período). */
  const allInAttendance = useMemo(() => leads.filter((l) => isInAttendance(l)), [leads]);

  const closeAllAttendances = async () => {
    const targets = allInAttendance;
    if (targets.length === 0 || closeBatchOpen) return;

    if (!whatsappConnected) {
      toast.error("WhatsApp desconectado — reconecte para finalizar e enviar a pesquisa");
      return;
    }

    const withPhone = targets.filter((l) => hasValidBatchPhone(l.phone_whatsapp));
    const withoutPhone = targets.length - withPhone.length;
    const delaySec = 12;
    const secPerLead = 40; // envio Whapi (2 msgs + fila) + pausa
    const etaMin = Math.ceil((withPhone.length * secPerLead) / 60);

    const ok = await confirm({
      title: `Finalizar ${targets.length} atendimento${targets.length === 1 ? "" : "s"}?`,
      description: [
        `Cada cliente receberá a mensagem de encerramento e a pesquisa de satisfação (1–5).`,
        withPhone.length > 0
          ? `Envio 1 a 1, com pausa de ~${delaySec}s entre leads (fila WhatsApp). Estimativa: ~${etaMin} min para ${withPhone.length}.`
          : null,
        withoutPhone > 0
          ? `${withoutPhone} sem telefone válido serão fechados sem WhatsApp.`
          : null,
        `Você acompanhará cada envio e a pausa anti-ban em tempo real.`,
      ].filter(Boolean).join("\n\n"),
      confirmText: withPhone.length > 0 ? `Enviar e fechar (${withPhone.length})` : "Fechar sem envio",
      cancelText: "Cancelar",
      tone: "danger",
    });
    if (!ok) return;

    // Segunda confirmação se lote grande (cuidado anti-ban / massa).
    if (withPhone.length >= 10) {
      const ok2 = await confirm({
        title: `Confirmar envio em massa?`,
        description: `Você vai disparar encerramento + pesquisa para ${withPhone.length} clientes agora.\n\nIsso é irreversível e conta como envio em lote no WhatsApp.`,
        confirmText: "Sim, enviar para todos",
        cancelText: "Cancelar",
        tone: "danger",
      });
      if (!ok2) return;
    }

    setCloseBatchLeads(targets);
    setCloseBatchOpen(true);
  };

  return (
    <aside className="w-full md:w-auto md:shrink-0 flex flex-col flex-1 h-full border-b md:border-b-0 md:border-r border-border bg-card/40 min-h-0 overflow-hidden">
      <div className="p-2.5 border-b border-border space-y-2 shrink-0 bg-card">
        <div className="flex items-center flex-wrap gap-x-2 gap-y-1">
          <h3 className="text-sm font-semibold">Conversas</h3>
          <span className="text-[11px] tabular-nums font-medium text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded-full">
            {filtered.length}
          </span>
          {unreadTotal > 0 && (
            <span className="text-[10px] tabular-nums font-bold text-primary-foreground bg-primary px-1.5 py-0.5 rounded-full">
              {unreadTotal}
            </span>
          )}
          {activeToday > 0 && (
            <span
              className="text-[10px] tabular-nums font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded-full"
              title="Leads com mensagem hoje"
            >
              {activeToday} hoje
            </span>
          )}
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => setShowNewChat((v) => !v)}
              className="h-7 w-7 inline-flex items-center justify-center rounded-lg hover:bg-primary/10 text-muted-foreground hover:text-primary transition"
              title="Nova conversa por número"
              aria-label="Nova conversa por número"
            >
              <MessageCirclePlus className="h-4 w-4" />
            </button>
            {onCollapseList && (
              <button
                type="button"
                onClick={onCollapseList}
                title="Recolher lista"
                aria-label="Recolher lista"
                className="hidden md:inline-flex h-6 w-6 items-center justify-center rounded-md border border-border bg-card text-muted-foreground hover:text-primary hover:border-primary/50"
              >
                <PanelLeftClose className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {showNewChat && (
          <div className="rounded-lg border border-primary/25 bg-primary/5 p-2">
            <p className="text-[10px] text-muted-foreground mb-1.5 font-medium">
              Nova conversa — digite o número:
            </p>
            <div className="flex gap-1.5">
              <Input
                ref={newPhoneRef}
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                placeholder="(11) 99999-9999"
                className="h-8 text-xs flex-1 bg-background rounded-lg"
                disabled={startingByPhone}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void startByPhone(newPhone);
                  }
                }}
              />
              <Button
                size="sm"
                className="h-8 px-3 text-xs"
                disabled={startingByPhone || newPhone.replace(/\D/g, "").length < 10}
                onClick={() => void startByPhone(newPhone)}
              >
                {startingByPhone ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Iniciar"}
              </Button>
              <button
                type="button"
                onClick={() => { setShowNewChat(false); setNewPhone(""); }}
                className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-secondary transition-colors"
                title="Fechar"
              >
                <X className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </div>
          </div>
        )}


        <div className="flex items-center gap-1 min-w-0 max-w-full overflow-x-auto overscroll-x-contain scrollbar-none">
          {unreadTotal > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-[11px] gap-1 shrink-0"
              onClick={markAllRead}
              title="Marcar todas como lidas"
            >
              <CheckCheck className="w-3 h-3 shrink-0" />
              <span className="hidden sm:inline">Ler tudo</span>
            </Button>
          )}
          <Button
            size="sm"
            variant={selectMode ? "secondary" : "outline"}
            className="h-7 px-2 text-[11px] gap-1 shrink-0"
            onClick={toggleSelectMode}
            title={selectMode ? "Cancelar seleção" : "Selecionar"}
          >
            {selectMode ? (
              <>
                <X className="w-3 h-3 shrink-0" />
                <span className="hidden sm:inline">Cancelar</span>
              </>
            ) : (
              <>
                <CheckSquare className="w-3 h-3 shrink-0" />
                <span className="hidden sm:inline">Selecionar</span>
              </>
            )}
          </Button>
          {allInAttendance.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-[11px] gap-1 shrink-0 border-amber-500/40 text-amber-700 hover:bg-amber-500/10 dark:text-amber-400"
              onClick={() => void closeAllAttendances()}
              disabled={closeBatchOpen}
              title="Finaliza todos com mensagem de encerramento + pesquisa (1 a 1, com intervalo)"
            >
              {closeBatchOpen ? (
                <Loader2 className="w-3 h-3 shrink-0 animate-spin" />
              ) : (
                <LogOut className="w-3 h-3 shrink-0" />
              )}
              <span className="truncate max-w-[7.5rem] sm:max-w-none">
                {closeBatchOpen
                  ? "Finalizando…"
                  : `Fechar (${allInAttendance.length})`}
              </span>
            </Button>
          )}
        </div>

        <div className="flex flex-wrap gap-1">
          {PERIOD_OPTIONS.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => setPeriod(o.key)}
              className={`px-2 py-0.5 text-[10px] font-semibold rounded-md transition ${
                period === o.key
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>


        {selectMode && (
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              type="button"
              size="sm"
              variant={allOnTabSelected ? "secondary" : "default"}
              className="h-7 px-2.5 text-[11px] gap-1"
              onClick={allOnTabSelected ? clearSelection : selectAllOnTab}
              disabled={tabSelectableCount === 0}
              title={
                activeTab === "atendimento"
                  ? "Seleciona todos em atendimento nesta aba"
                  : "Seleciona todos em espera nesta aba"
              }
            >
              <CheckSquare className="w-3 h-3 shrink-0" />
              {allOnTabSelected
                ? "Limpar seleção"
                : `Selecionar todos (${tabSelectableCount})`}
            </Button>
            <button
              type="button"
              className="text-[10px] font-medium text-primary hover:underline px-1"
              onClick={selectAllFiltered}
            >
              Todo o período
            </button>
            <span className="text-[10px] text-muted-foreground">·</span>
            <button
              type="button"
              className="text-[10px] font-medium text-primary hover:underline px-1"
              onClick={selectWithoutAttendance}
            >
              Só sem atendimento
            </button>
            {selectedVisibleCount > 0 && (
              <>
                <span className="text-[10px] text-muted-foreground">·</span>
                <button
                  type="button"
                  className="text-[10px] font-medium text-muted-foreground hover:underline px-1"
                  onClick={clearSelection}
                >
                  Limpar
                </button>
              </>
            )}
          </div>
        )}

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar nome ou telefone"
            className="h-9 pl-8 text-xs rounded-lg"
          />
        </div>

        {/* Origem: campanha Meta vs mensagem qualquer */}
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted/50 p-0.5">
          {([
            { key: "all" as const, label: "Todos", count: originCounts.all, icon: null },
            { key: "campanha" as const, label: "Campanha", count: originCounts.campanha, icon: <Megaphone className="w-3 h-3 shrink-0" /> },
            { key: "mensagem" as const, label: "Mensagem", count: originCounts.mensagem, icon: <MessageCircle className="w-3 h-3 shrink-0" /> },
          ]).map((t) => {
            const active = originTab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setOriginTab(t.key)}
                title={
                  t.key === "campanha"
                    ? "Veio de anúncio/campanha Meta"
                    : t.key === "mensagem"
                      ? "Chegou por mensagem qualquer (sem campanha)"
                      : "Todas as origens"
                }
                className={`relative flex items-center justify-center gap-1 rounded-md py-1.5 text-[11px] font-semibold transition ${
                  active
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.icon}
                <span className="truncate">{t.label}</span>
                <span className={`text-[10px] tabular-nums font-bold px-1.5 py-px rounded-full ${
                  active ? "bg-primary/15 text-primary" : "bg-background/80 text-muted-foreground border border-border/60"
                }`}>{t.count}</span>
              </button>
            );
          })}
        </div>

        {/* Abas Em atendimento / Em espera (padrão WhatsApp Business) */}
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted/50 p-0.5">
          {([
            { key: "atendimento" as const, label: "Em atendimento", count: emAtendimento.length, unread: unreadByTab.atend, live: emAtendimento.length > 0 },
            { key: "espera" as const, label: "Em espera", count: emEspera.length, unread: unreadByTab.esp, live: false },
          ]).map((t) => {
            const active = activeTab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setActiveTab(t.key)}
                className={`relative flex items-center justify-center gap-1.5 rounded-md py-1.5 text-[11px] font-semibold transition ${
                  active
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.live && active && (
                  <span className="relative inline-flex w-1.5 h-1.5">
                    <span className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-60" />
                    <span className="relative inline-flex w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  </span>
                )}
                <span className="truncate">{t.label}</span>
                <span className={`text-[10px] tabular-nums font-bold px-1.5 py-px rounded-full ${
                  active ? "bg-primary/15 text-primary" : "bg-background/80 text-muted-foreground border border-border/60"
                }`}>{t.count}</span>
                {t.unread > 0 && (
                  <span className="text-[9px] tabular-nums font-bold text-primary-foreground bg-primary min-w-[14px] h-[14px] px-1 rounded-full flex items-center justify-center">
                    {t.unread > 9 ? "9+" : t.unread}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Barra sticky no TOPO da lista quando há seleção — CTA principal para
          disparar rápido (1 lead) ou abrir o modal (2+). Espelha o rodapé, mas
          fica acessível sem rolar. */}
      {selectMode && selectedVisibleCount > 0 && (
        <div className="sticky top-0 z-10 px-2 py-1.5 border-b border-border bg-primary/5 backdrop-blur flex items-center gap-1.5 shrink-0">
          <span className="text-[11px] font-semibold tabular-nums text-primary shrink-0 px-1">
            {selectedVisibleCount} sel.
          </span>
          <Button
            size="sm"
            variant="default"
            className="flex-1 h-8 text-[11px] rounded-lg"
            disabled={!whatsappConnected}
            title={!whatsappConnected ? "WhatsApp desconectado" : undefined}
            onClick={openBatch}
          >
            {selectedVisibleCount === 1
              ? "Iniciar atendimento"
              : `Abrir atendimento (${selectedVisibleCount})`}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 px-2 text-[11px]"
            onClick={clearSelection}
            title="Limpar seleção"
          >
            <X className="w-3 h-3" />
          </Button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">

        {loading && <p className="p-6 text-center text-xs text-muted-foreground">Carregando...</p>}
        {!loading && filtered.length === 0 && (
          <div className="p-6 text-center space-y-2">
            <UserPlus className="w-8 h-8 mx-auto text-muted-foreground/50" />
            <p className="text-xs text-muted-foreground">
              {originTab === "campanha"
                ? "Nenhum lead de campanha neste período."
                : originTab === "mensagem"
                  ? "Nenhuma conversa por mensagem neste período."
                  : "Nenhum cliente neste período."}
            </p>
            <p className="text-[11px] text-muted-foreground/80 max-w-[240px] mx-auto">
              Use o botão <span className="font-semibold text-foreground">+</span> para abrir conversa por número,
              ou <span className="font-semibold text-foreground">Selecionar</span> para atendimento em lote.
            </p>
          </div>
        )}
        {!loading && filtered.length > 0 && (
          <GroupedLeads
            mode={activeTab}
            consultantId={consultantId}
            leads={activeTab === "atendimento" ? emAtendimento : emEspera}
            selectedId={selectedId}
            selectMode={selectMode}
            selectedIds={selectedIds}
            onSelect={onSelect}
            toggleId={toggleId}
            fmtTime={fmtTime}
            fmtPhone={fmtPhone}
            unread={unread}
            flash={flash}
            onOriginSaved={applyOriginSaved}
            tagsByJid={tagsByJid}
            onTagsChange={reloadTags}
            onEditOrigin={setOriginLead}
          />
        )}
      </div>

      {originLead && (
        <LeadOriginEditorDialog
          open={!!originLead}
          onOpenChange={(v) => {
            if (!v) setOriginLead(null);
          }}
          customerId={originLead.id}
          consultantId={consultantId}
          initialPartnerId={originLead.partnerId}
          initialCampaignId={originLead.campaignId}
          initialPartnerName={originLead.partnerName}
          initialCampaignName={originLead.campaignName}
          onSaved={(saved) => {
            applyOriginSaved(originLead.id, saved);
            setOriginLead(null);
          }}
        />
      )}

      {closeBatchOpen && (
        <CloseAttendanceBatchDialog
          open={closeBatchOpen}
          onOpenChange={(o) => {
            setCloseBatchOpen(o);
            if (!o) setCloseBatchLeads([]);
          }}
          consultantId={consultantId}
          leads={closeBatchLeads}
          onFinished={() => {
            try {
              window.dispatchEvent(new CustomEvent("captacao:batch-finished"));
            } catch { /* ignore */ }
            void load();
          }}
        />
      )}


      {selectMode && selectedVisibleCount > 0 ? (
        <div className="p-2 border-t border-border flex items-center gap-1.5 shrink-0 bg-card/80">
          <span className="text-[11px] font-medium tabular-nums text-muted-foreground shrink-0 px-1">
            {selectedVisibleCount} sel.
          </span>
          <Button
            size="sm"
            variant="default"
            className="flex-1 min-h-[44px] lg:h-8 text-[11px] rounded-lg"
            disabled={!whatsappConnected}
            title={!whatsappConnected ? "WhatsApp desconectado" : undefined}
            onClick={openBatch}
          >
            {selectedVisibleCount === 1
              ? "Iniciar atendimento"
              : `Abrir atendimento (${selectedVisibleCount}) — áudio/mensagem`}
          </Button>
        </div>
      ) : (
        <div className="p-2 border-t border-border flex items-center gap-1.5 shrink-0">
          <Button
            size="sm"
            variant="default"
            className="flex-1 min-h-[44px] lg:h-8 text-[11px] gap-1.5 rounded-lg"
            onClick={async () => {
              const phone = await prompt({
                title: "Nova conversa por número",
                description: "Informe o telefone do cliente interessado (com DDD).",
                placeholder: "Ex: 11971254913",
                confirmText: "Iniciar",
              });
              if (!phone) return;
              await startByPhone(phone);
            }}
          >
            <UserPlus className="w-3.5 h-3.5" /> Novo por número
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-11 w-11 lg:h-8 lg:w-8 shrink-0"
            title="Atualizar lista"
            onClick={() => void load()}
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
        </div>
      )}
    </aside>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Agrupamento: "Em atendimento" (welcome_sent_at != null) e "Em espera"
// subdividido em Hoje / Ontem / Semana / Antigos (padrão Intercom / HubSpot).
// ─────────────────────────────────────────────────────────────────────────────
interface GroupedLeadsProps {
  consultantId: string;
  leads: CaptureBatchLead[];
  selectedId: string | null;
  selectMode: boolean;
  selectedIds: Set<string>;
  onSelect: (id: string) => void;
  toggleId: (id: string) => void;
  fmtTime: (iso: string | null) => string;
  fmtPhone: (p: string | null) => string;
  unread: Record<string, number>;
  flash: Record<string, number>;
  onOriginSaved: (leadId: string, saved: LeadOriginSaved) => void;
  tagsByJid: Map<string, CustomerTag[]>;
  onTagsChange: () => void;
  onEditOrigin: (lead: CaptureBatchLead) => void;
}

function useGroupOpen(key: string, initial: boolean) {
  const [open, setOpen] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem(`cap_group_${key}`);
      return v === null ? initial : v === "1";
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(`cap_group_${key}`, open ? "1" : "0");
    } catch {}
  }, [key, open]);
  return [open, setOpen] as const;
}

function timeBucket(l: CaptureBatchLead): "hoje" | "ontem" | "semana" | "antigos" {
  const t = activityAnchor(l);
  if (!t) return "antigos";
  const now = new Date();
  const d = new Date(t);
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startYesterday = startToday - 86400000;
  const startWeek = startToday - 6 * 86400000;
  if (t >= startToday) return "hoje";
  if (t >= startYesterday) return "ontem";
  if (t >= startWeek) return "semana";
  return "antigos";
}

function GroupedLeads(props: GroupedLeadsProps & { mode: "atendimento" | "espera" }) {
  const { leads, mode } = props;
  const buckets = useMemo(() => {
    const espera = { hoje: [] as CaptureBatchLead[], ontem: [] as CaptureBatchLead[], semana: [] as CaptureBatchLead[], antigos: [] as CaptureBatchLead[] };
    for (const l of leads) espera[timeBucket(l)].push(l);
    return espera;
  }, [leads]);

  if (mode === "atendimento") {
    if (leads.length === 0) {
      return (
        <p className="p-6 text-center text-xs text-muted-foreground">
          Nenhum lead em atendimento agora.
        </p>
      );
    }
    return (
      <ul className="divide-y divide-border/60">
        {sortByActivity(leads).map((l) => (
          <LeadCard
            key={l.id}
            lead={l}
            consultantId={props.consultantId}
            selectedId={props.selectedId}
            selectMode={props.selectMode}
            selectedIds={props.selectedIds}
            onSelect={props.onSelect}
            toggleId={props.toggleId}
            fmtTime={props.fmtTime}
            fmtPhone={props.fmtPhone}
            unreadCount={props.unread[l.id] || 0}
            flashAt={props.flash[l.id] || 0}
            onOriginSaved={props.onOriginSaved}
            tagsByJid={props.tagsByJid}
            onTagsChange={props.onTagsChange}
            onEditOrigin={props.onEditOrigin}
          />
        ))}
      </ul>
    );
  }

  if (leads.length === 0) {
    return (
      <p className="p-6 text-center text-xs text-muted-foreground">
        Nenhum lead em espera.
      </p>
    );
  }

  return (
    <div>
      <LeadSection {...props} groupKey="espera_hoje" title="Hoje" icon={<Clock className="w-3 h-3" />} toneClass="text-amber-700 dark:text-amber-400" leads={sortByActivity(buckets.hoje)} defaultOpen />
      <LeadSection {...props} groupKey="espera_ontem" title="Ontem" icon={<Clock className="w-3 h-3" />} toneClass="text-amber-700 dark:text-amber-400" leads={sortByActivity(buckets.ontem)} defaultOpen />
      <LeadSection {...props} groupKey="espera_semana" title="Últimos 7 dias" icon={<Clock className="w-3 h-3" />} toneClass="text-amber-700 dark:text-amber-400" leads={sortByActivity(buckets.semana)} defaultOpen={false} />
      <LeadSection {...props} groupKey="espera_antigos" title="Mais antigos" icon={<Clock className="w-3 h-3" />} toneClass="text-muted-foreground" leads={sortByActivity(buckets.antigos)} defaultOpen={false} />
    </div>
  );
}

interface LeadSectionProps extends GroupedLeadsProps {
  groupKey: string;
  title: string;
  icon: React.ReactNode;
  toneClass: string;
  defaultOpen: boolean;
  showLiveDot?: boolean;
}

function LeadSection({
  consultantId,
  groupKey,
  title,
  icon,
  toneClass,
  leads,
  defaultOpen,
  selectedId,
  selectMode,
  selectedIds,
  onSelect,
  toggleId,
  fmtTime,
  fmtPhone,
  unread,
  flash,
  showLiveDot,
  onOriginSaved,
  tagsByJid,
  onTagsChange,
  onEditOrigin,
}: LeadSectionProps) {
  const [open, setOpen] = useGroupOpen(groupKey, defaultOpen);
  if (leads.length === 0) return null;
  return (
    <section className="border-b border-border/40 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-1.5 px-2.5 py-1.5 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80 border-b border-border/50 shadow-[0_1px_0_0_hsl(var(--border)/0.4)] hover:bg-muted/40 transition sticky top-0 z-[2]"
      >
        {open ? (
          <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
        )}
        <span className={`inline-flex items-center gap-1 ${toneClass}`}>{icon}</span>
        <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
          {title}
        </span>
        {showLiveDot && leads.length > 0 && (
          <span className="relative inline-flex w-1.5 h-1.5 ml-0.5">
            <span className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-60" />
            <span className="relative inline-flex w-1.5 h-1.5 rounded-full bg-emerald-500" />
          </span>
        )}
        <span className="ml-auto text-[10px] tabular-nums font-semibold text-foreground/80 bg-background/90 border border-border/60 px-1.5 py-0.5 rounded-full">
          {leads.length}
        </span>
      </button>

      {open && (
        leads.length > 50 ? (
          <div className="h-[min(420px,50vh)]">
            <VirtualList
              items={leads}
              estimateSize={72}
              overscan={8}
              height="100%"
              getItemKey={(l) => l.id}
              renderItem={(l) => (
                <LeadCard
                  lead={l}
                  consultantId={consultantId}
                  selectedId={selectedId}
                  selectMode={selectMode}
                  selectedIds={selectedIds}
                  onSelect={onSelect}
                  toggleId={toggleId}
                  fmtTime={fmtTime}
                  fmtPhone={fmtPhone}
                  unreadCount={unread[l.id] || 0}
                  flashAt={flash[l.id] || 0}
                  onOriginSaved={onOriginSaved}
                  tagsByJid={tagsByJid}
                  onTagsChange={onTagsChange}
                  onEditOrigin={onEditOrigin}
                />
              )}
            />
          </div>
        ) : (
          <ul className="divide-y divide-border/60">
            {leads.map((l) => (
              <LeadCard
                key={l.id}
                lead={l}
                consultantId={consultantId}
                selectedId={selectedId}
                selectMode={selectMode}
                selectedIds={selectedIds}
                onSelect={onSelect}
                toggleId={toggleId}
                fmtTime={fmtTime}
                fmtPhone={fmtPhone}
                unreadCount={unread[l.id] || 0}
                flashAt={flash[l.id] || 0}
                onOriginSaved={onOriginSaved}
                tagsByJid={tagsByJid}
                onTagsChange={onTagsChange}
                onEditOrigin={onEditOrigin}
              />
            ))}
          </ul>
        )
      )}
    </section>
  );
}

interface LeadCardProps {
  lead: CaptureBatchLead;
  consultantId: string;
  selectedId: string | null;
  selectMode: boolean;
  selectedIds: Set<string>;
  onSelect: (id: string) => void;
  toggleId: (id: string) => void;
  fmtTime: (iso: string | null) => string;
  fmtPhone: (p: string | null) => string;
  unreadCount: number;
  flashAt: number;
  onOriginSaved: (leadId: string, saved: LeadOriginSaved) => void;
  tagsByJid: Map<string, CustomerTag[]>;
  onTagsChange: () => void;
  onEditOrigin: (lead: CaptureBatchLead) => void;
}

function LeadCard({
  lead: l,
  consultantId,
  selectedId,
  selectMode,
  selectedIds,
  onSelect,
  toggleId,
  fmtTime,
  fmtPhone,
  unreadCount,
  flashAt,
  onEditOrigin,
  tagsByJid,
  onTagsChange,
}: LeadCardProps) {
  const active = l.id === selectedId && !selectMode;
  const pct = Math.round((l.filled / CAPTURE_FIELDS.length) * 100);
  const ready = l.filled >= CAPTURE_FIELDS.length;
  const checked = selectedIds.has(l.id);
  const hasUnread = unreadCount > 0;

  // Piscar borda por 4s após novo inbound
  const [flashOn, setFlashOn] = useState(false);
  useEffect(() => {
    if (!flashAt) return;
    setFlashOn(true);
    const t = window.setTimeout(() => setFlashOn(false), 4000);
    return () => window.clearTimeout(t);
  }, [flashAt]);

  const borderClass =
    selectMode && checked
      ? "bg-primary/20 border-l-4 border-primary ring-1 ring-inset ring-primary/40"
      : active
        ? "bg-primary/10 border-l-4 border-primary"
        : flashOn
          ? "bg-emerald-500/10 border-l-4 border-emerald-500"
          : hasUnread
            ? "bg-primary/[0.04] border-l-4 border-primary/60"
            : "border-l-4 border-transparent hover:bg-secondary/50";

  const enterSelectAndToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!selectMode) {
      toggleId(l.id);
    } else {
      toggleId(l.id);
    }
  };

  const openOrigin = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onEditOrigin(l);
  };

  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        aria-pressed={selectMode ? checked : undefined}
        onClick={() => {
          if (selectMode) toggleId(l.id);
          else onSelect(l.id);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (selectMode) toggleId(l.id);
            else onSelect(l.id);
          }
        }}
        className={`group w-full text-left px-2.5 py-2.5 flex gap-2.5 transition-colors cursor-pointer ${borderClass}`}
      >
        {selectMode ? (
          <div
            className="shrink-0 pt-2 pl-0.5"
            onClick={(e) => {
              e.stopPropagation();
              toggleId(l.id);
            }}
          >
            <Checkbox
              checked={checked}
              onCheckedChange={() => toggleId(l.id)}
              aria-label={`Selecionar ${l.name || l.id}`}
              className="h-6 w-6 border-2 border-primary/70 bg-background data-[state=checked]:bg-primary data-[state=checked]:border-primary data-[state=checked]:text-primary-foreground shadow"
            />
          </div>
        ) : null}
        <div
          className={`relative shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold ${toneFor(l.id)} ${!selectMode ? "cursor-pointer" : ""}`}
          onClick={!selectMode ? enterSelectAndToggle : undefined}
          title={!selectMode ? "Clique no avatar para selecionar" : undefined}
        >
          {selectMode && checked ? (
            <span className="text-primary-foreground bg-primary w-full h-full rounded-full flex items-center justify-center">✓</span>
          ) : (
            initialsFrom(l.name, l.phone_whatsapp)
          )}
          {ready && (
            <span
              className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-primary border-2 border-card"
              title="Cadastro completo"
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <span
              className={`flex-1 min-w-0 truncate text-[13px] leading-tight text-foreground sensitive-name ${hasUnread ? "font-bold" : "font-medium"}`}
            >
              {l.name || "Sem nome"}
            </span>
            <span className={`text-[10px] tabular-nums shrink-0 ${hasUnread ? "text-primary font-semibold" : "text-muted-foreground"}`}>
              {fmtTime(l.lastMsgAt || l.created_at)}
            </span>
            {hasUnread && (
              <span className="text-[10px] tabular-nums font-bold text-primary-foreground bg-primary min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center shrink-0">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
            {!selectMode && l.phone_whatsapp && !/sem_celular/i.test(l.phone_whatsapp) && (
              <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
                <ScheduleCallButton
                  phone={l.phone_whatsapp}
                  consultantId={consultantId}
                  contactName={l.name}
                  customerId={l.id}
                  triggerLabel="Ligar"
                  size="sm"
                  variant="ghost"
                  className="h-6 px-1.5 text-[10px] gap-0.5 text-muted-foreground hover:text-primary hover:bg-primary/10"
                />
              </div>
            )}
          </div>
          <p
            className={`truncate text-[11px] mt-0.5 sensitive-phone ${hasUnread ? "text-foreground/80 font-medium" : "text-muted-foreground"}`}
          >
            {l.lastMsg ? l.lastMsg : fmtPhone(l.phone_whatsapp)}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1" onClick={(e) => e.stopPropagation()}>
            {!ready && l.nextMissingLabel && (
              <span
                className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[9.5px] font-medium text-primary max-w-[160px] truncate"
                title={`Próximo campo: ${l.nextMissingLabel}`}
              >
                Falta {l.nextMissingLabel}
              </span>
            )}
            {l.fromCampaign && !l.campaignName && (
              <span
                className="inline-flex items-center rounded-full border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 text-[9.5px] font-medium text-sky-700 dark:text-sky-300"
                title="Veio de campanha / anúncio Meta"
              >
                Campanha
              </span>
            )}
            {l.conversationStep && (
              <span
                className="inline-flex items-center rounded-full border border-border/70 bg-muted/50 px-1.5 py-0.5 text-[9.5px] font-medium text-muted-foreground max-w-[140px] truncate"
                title={`Passo: ${l.conversationStep}`}
              >
                {l.conversationStep.replace(/_/g, " ")}
              </span>
            )}
            {l.botPaused && (
              <span
                className="inline-flex items-center rounded-full border border-border/70 bg-muted/40 px-1.5 py-0.5 text-[9.5px] font-medium text-muted-foreground"
                title="IA pausada neste lead"
              >
                IA off
              </span>
            )}
            {l.partnerName && (
              <button
                type="button"
                className="inline-flex items-center gap-0.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[9.5px] font-medium text-amber-700 dark:text-amber-300 max-w-[140px] truncate hover:bg-amber-500/20"
                title={`Indicação: ${l.partnerName} — clicar para editar`}
                onClick={openOrigin}
              >
                🤝 {l.partnerName}
              </button>
            )}
            {l.campaignName && (
              <button
                type="button"
                className="inline-flex items-center gap-0.5 rounded-full border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 text-[9.5px] font-medium text-sky-700 dark:text-sky-300 max-w-[140px] truncate hover:bg-sky-500/20"
                title={`Campanha: ${l.campaignName} — clicar para editar`}
                onClick={openOrigin}
              >
                🎯 {l.campaignName}
              </button>
            )}
            {!l.partnerName && !l.campaignName && !selectMode && (
              <button
                type="button"
                className="inline-flex items-center gap-0.5 rounded-full border border-border/70 bg-muted/40 px-1.5 py-0.5 text-[9.5px] font-medium text-muted-foreground hover:bg-muted"
                title="Definir origem (indicação ou campanha)"
                onClick={openOrigin}
              >
                + Origem
              </button>
            )}
          </div>
          <CustomerTagsEditor
            consultantId={consultantId}
            phone={l.phone_whatsapp}
            compact
            preloadedTags={
              phoneToRemoteJid(l.phone_whatsapp)
                ? tagsByJid.get(phoneToRemoteJid(l.phone_whatsapp)!) || []
                : []
            }
            onTagsChange={onTagsChange}
            className="mt-1"
          />
          <div className="mt-1.5 h-1 rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${ready ? "bg-primary" : "bg-primary/60"}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </div>
    </li>
  );
}
