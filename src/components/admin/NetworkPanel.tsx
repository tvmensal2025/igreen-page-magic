import { useState, useEffect, useMemo, useCallback, useRef, useLayoutEffect, lazy, Suspense } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Users, UserCheck, TrendingUp, CheckCircle2, RefreshCw, Loader2, Search, MessageCircle, Table2, Network, ZoomIn, ZoomOut, MapPin, Calendar, Phone, X, ChevronDown, Zap, Award, ExternalLink, KeyRound, Plus, GitBranch, ListTree } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { useToast } from "@/components/ui/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { runIgreenSync } from "@/lib/igreenSync";

const IGreenConnectionCard = lazy(() => import("@/components/admin/IGreenConnectionCard").then(m => ({ default: m.IGreenConnectionCard })));


interface NetworkMember {
  id: string;
  igreen_id: number;
  name: string;
  phone: string | null;
  sponsor_id: number | null;
  nivel: number;
  data_ativo: string | null;
  cidade: string | null;
  uf: string | null;
  clientes_ativos: number;
  gp: number;
  gi: number;
  qtde_diretos: number;
  total_pontos: number;
  updated_at: string;
  graduacao: string | null;
  graduacao_expansao: string | null;
  data_nascimento: string | null;
  gp_total: number;
  gi_total: number;
  bonificavel: number;
  green_points: number;
  gp_mes: number;
  gi_mes: number;
  green_points_mes: number;
  diretos_ativos: number;
  pro: string | null;
  inicio_rapido: string | null;
  diretos_inicio_rapido: number;
  diretos_mes: number;
  sponsor_override_id?: number | null;
}

function effectiveSponsor(m: { sponsor_id: number | null; sponsor_override_id?: number | null }) {
  return (m.sponsor_override_id ?? m.sponsor_id) || null;
}

function emptyMemberStats(partial: Pick<NetworkMember, "id" | "igreen_id" | "name">): NetworkMember {
  return {
    id: partial.id,
    igreen_id: partial.igreen_id,
    name: partial.name,
    phone: null,
    sponsor_id: null,
    nivel: 0,
    data_ativo: null,
    cidade: null,
    uf: null,
    clientes_ativos: 0,
    gp: 0,
    gi: 0,
    qtde_diretos: 0,
    total_pontos: 0,
    updated_at: "",
    graduacao: null,
    graduacao_expansao: null,
    data_nascimento: null,
    gp_total: 0,
    gi_total: 0,
    bonificavel: 0,
    green_points: 0,
    gp_mes: 0,
    gi_mes: 0,
    green_points_mes: 0,
    diretos_ativos: 0,
    pro: null,
    inicio_rapido: null,
    diretos_inicio_rapido: 0,
    diretos_mes: 0,
    sponsor_override_id: null,
  };
}

/**
 * Garante o dono da página (consultor) como raiz visual:
 * - injeta o consultor se a sync só trouxe a rede de uma subconta (Sirlene/Nilma);
 * - recalcula níveis a partir dele;
 * - quem não alcança o dono fica pendurado nele (nunca como raiz concorrente).
 */
type SubAccountSeed = { igreenId: number; name: string };

function normalizeMembersForViewer(
  members: NetworkMember[],
  viewerIgreenId: number | null,
  viewerName = "Você",
  subAccounts: SubAccountSeed[] = [],
): NetworkMember[] {
  if (!viewerIgreenId) return members;
  if (members.length === 0 && subAccounts.length === 0) return members;

  const list = [...members];
  const byId = new Map(list.map((m) => [m.igreen_id, m]));

  if (!byId.has(viewerIgreenId)) {
    const placeholder = emptyMemberStats({
      id: `viewer-root-${viewerIgreenId}`,
      igreen_id: viewerIgreenId,
      name: viewerName || "Você",
    });
    list.unshift(placeholder);
    byId.set(viewerIgreenId, placeholder);
  }

  // Subcontas conectadas (Sirlene, Nilma, …) entram abaixo do dono só se
  // ainda não existem na lista. Sem override automático: o consultor organiza
  // no painel lateral quem fica abaixo de quem.
  for (const sub of subAccounts) {
    if (!sub.igreenId || sub.igreenId === viewerIgreenId) continue;
    if (byId.has(sub.igreenId)) continue;
    const seed = {
      ...emptyMemberStats({
        id: `subaccount-${sub.igreenId}`,
        igreen_id: sub.igreenId,
        name: sub.name || `Licenciado #${sub.igreenId}`,
      }),
      nivel: 1,
      sponsor_id: viewerIgreenId,
    };
    list.push(seed);
    byId.set(sub.igreenId, seed);
  }

  const depthFromViewer = new Map<number, number>();
  depthFromViewer.set(viewerIgreenId, 0);
  const queue = [viewerIgreenId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const parentDepth = depthFromViewer.get(current)!;
    for (const m of list) {
      if (m.igreen_id === viewerIgreenId) continue;
      const sponsor = effectiveSponsor(m);
      if (sponsor === current && !depthFromViewer.has(m.igreen_id)) {
        depthFromViewer.set(m.igreen_id, parentDepth + 1);
        queue.push(m.igreen_id);
      }
    }
  }

  return list.map((m) => {
    if (m.igreen_id === viewerIgreenId) {
      return m.nivel === 0 ? m : { ...m, nivel: 0 };
    }
    const depth = depthFromViewer.get(m.igreen_id);
    if (depth != null) {
      return depth === m.nivel ? m : { ...m, nivel: depth };
    }
    // Sem upline conhecido: fica como raiz secundária até o consultor organizar.
    // NÃO forçar abaixo de ninguém (evita Nilma cair sob Leonardo por engano).
    return m;
  });
}

interface TreeNode {
  member: NetworkMember;
  children: TreeNode[];
  isOrphan?: boolean;
}

interface NetworkPanelProps {
  consultantId: string;
}

/* ── Helpers ── */

const nameCollator = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });

function sortNodes(nodes: TreeNode[]) {
  nodes.sort((a, b) => {
    const orphanDiff = Number(a.isOrphan) - Number(b.isOrphan);
    if (orphanDiff !== 0) return orphanDiff;

    const directsDiff = (b.member.qtde_diretos || 0) - (a.member.qtde_diretos || 0);
    if (directsDiff !== 0) return directsDiff;

    const nameDiff = nameCollator.compare(a.member.name, b.member.name);
    if (nameDiff !== 0) return nameDiff;

    return a.member.igreen_id - b.member.igreen_id;
  });

  nodes.forEach((node) => sortNodes(node.children));
}

/**
 * Monta a árvore só com patrocinadores reais (sponsor / override).
 * Não inventa “pai” para órfãos — isso colocava Nilma sob Leonardo por engano.
 * Órfãos viram raiz e o consultor organiza no painel lateral.
 */
function buildTree(members: NetworkMember[]): TreeNode[] {
  const byId = new Map<number, TreeNode>();
  const membersSorted = [...members].sort((a, b) => a.nivel - b.nivel || a.igreen_id - b.igreen_id);

  membersSorted.forEach((m) => {
    byId.set(m.igreen_id, { member: m, children: [], isOrphan: false });
  });

  const roots: TreeNode[] = [];

  membersSorted.forEach((m) => {
    const node = byId.get(m.igreen_id)!;
    const sponsor = effectiveSponsor(m);
    if (sponsor && byId.has(sponsor) && sponsor !== m.igreen_id) {
      byId.get(sponsor)!.children.push(node);
    } else {
      if (sponsor && !byId.has(sponsor)) node.isOrphan = true;
      roots.push(node);
    }
  });

  sortNodes(roots);
  return roots;
}

function isPersistedMemberId(id: string) {
  return !!id && !id.startsWith("virtual-") && !id.startsWith("viewer-root-") && !id.startsWith("subaccount-");
}

function openWhatsApp(phone: string | null) {
  if (!phone) return;
  const clean = phone.replace(/\D/g, "");
  const num = clean.startsWith("55") ? clean : `55${clean}`;
  window.open(`https://wa.me/${num}`, "_blank");
}

function formatPhone(phone: string | null) {
  if (!phone || phone.length < 10) return null;
  const clean = phone.replace(/^55/, "");
  if (clean.length === 11) return `(${clean.slice(0, 2)}) ${clean.slice(2, 7)}-${clean.slice(7)}`;
  if (clean.length === 10) return `(${clean.slice(0, 2)}) ${clean.slice(2, 6)}-${clean.slice(6)}`;
  return phone;
}

/* ── Color System ── */
const NIVEL_PALETTE = [
  { bg: "from-primary to-primary", glow: "shadow-emerald-500/40", ring: "ring-primary/50", text: "text-primary", bar: "bg-primary/100" },
  { bg: "from-info to-info", glow: "shadow-blue-500/40", ring: "ring-info/50", text: "text-info", bar: "bg-info/100" },
  { bg: "from-primary to-primary", glow: "shadow-violet-500/40", ring: "ring-primary/50", text: "text-primary", bar: "bg-primary/100" },
  { bg: "from-warning to-warning", glow: "shadow-amber-500/40", ring: "ring-warning/50", text: "text-warning", bar: "bg-warning/100" },
  { bg: "from-destructive to-primary", glow: "shadow-rose-500/40", ring: "ring-destructive/50", text: "text-destructive", bar: "bg-destructive/100" },
  { bg: "from-info to-primary", glow: "shadow-cyan-500/40", ring: "ring-info/50", text: "text-info", bar: "bg-info/100" },
];

function getPalette(nivel: number) {
  return NIVEL_PALETTE[Math.min(nivel, NIVEL_PALETTE.length - 1)];
}

/* ── Node Card ── */
function NodeCard({ member, hasChildren, childCount, isExpanded, onToggle, onOpenDetails, isOrphan }: {
  member: NetworkMember;
  hasChildren: boolean;
  childCount: number;
  isExpanded: boolean;
  onToggle: () => void;
  onOpenDetails: () => void;
  isOrphan?: boolean;
}) {
  const isVirtual = member.id.startsWith("virtual-");
  const p = isVirtual
    ? { bg: "from-gray-500 to-gray-700", glow: "shadow-gray-500/20", ring: "ring-gray-400/30", text: "text-gray-400", bar: "bg-gray-500" }
    : getPalette(member.nivel);
  const initials = isVirtual ? "?" : member.name.split(" ").filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase();
  const isRoot = member.nivel === 0 && !isVirtual;

  return (
    <div className="flex flex-col items-center" data-node-id={member.igreen_id}>
      <div
        className={`relative rounded-2xl border transition-all duration-300 cursor-pointer select-none group
          ${isVirtual
            ? "w-[100px] border-dashed border-gray-500/40 bg-gray-500/5 hover:bg-gray-500/10"
            : isRoot
              ? `w-[120px] border-primary/30 bg-gradient-to-b from-primary/10 to-primary/5 hover:border-primary/60 hover:shadow-lg ${p.glow}`
              : `w-[100px] border-white/[0.06] bg-white/[0.03] hover:bg-white/[0.07] hover:border-white/[0.15] hover:shadow-lg hover:shadow-black/20${isOrphan ? " ring-1 ring-warning/20" : ""}`
          }
          backdrop-blur-sm p-2`}
        onClick={isVirtual ? undefined : onOpenDetails}
      >
        {/* Orphan badge */}
        {isVirtual && (
          <div className="absolute -top-2 left-1/2 -translate-x-1/2 text-[7px] px-1.5 py-0.5 rounded-full bg-warning/20 text-warning font-bold whitespace-nowrap">
            Externo
          </div>
        )}
        {/* Avatar */}
        <div className="flex justify-center mb-1.5">
          <div className={`${isRoot ? "w-11 h-11" : "w-9 h-9"} rounded-full bg-gradient-to-br ${p.bg}
            ring-2 ${p.ring} flex items-center justify-center shadow-lg ${p.glow} transition-transform duration-300 group-hover:scale-110
            ${isVirtual ? "border-dashed border border-gray-400/40" : ""}`}>
            <span className={`${isRoot ? "text-xs" : "text-[10px]"} font-bold text-white drop-shadow-sm`}>{initials}</span>
          </div>
        </div>

        {/* Name */}
        <p className={`${isRoot ? "text-[11px]" : "text-[10px]"} font-semibold ${isVirtual ? "text-gray-400" : "text-foreground"} text-center leading-tight truncate sensitive-name`}>
          {isVirtual ? `#${member.igreen_id}` : member.name.split(" ")[0]}
        </p>
        
        {/* Stats pills */}
        <div className="flex items-center justify-center gap-1 mt-1">
          <span className={`text-[8px] px-1.5 py-0.5 rounded-full ${member.clientes_ativos > 0 ? "bg-primary/15 text-primary" : "bg-white/5 text-muted-foreground"} font-medium`}>
            {member.clientes_ativos} cli
          </span>
          {member.qtde_diretos > 0 && (
            <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-info/15 text-info font-medium">
              {member.qtde_diretos} dir
            </span>
          )}
        </div>

        {/* WhatsApp hover */}
        {member.phone && (
          <button
            onClick={e => { e.stopPropagation(); openWhatsApp(member.phone); }}
            className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-primary/100 text-white
              flex items-center justify-center shadow-lg shadow-green-500/30 opacity-0 group-hover:opacity-100 
              transition-all duration-200 hover:bg-primary hover:scale-110 z-10"
            title="WhatsApp"
          >
            <MessageCircle className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Expand toggle */}
      {hasChildren && (
        <button
          onClick={onToggle}
          className={`mt-2 w-6 h-6 rounded-full flex items-center justify-center
            text-[9px] font-bold transition-all duration-300
            ${isExpanded 
              ? "bg-primary/20 text-primary border border-primary/30 shadow-sm shadow-primary/20" 
              : "bg-white/5 text-muted-foreground border border-white/10 hover:bg-white/10 hover:border-white/20"
            }`}
        >
          {isExpanded ? <ChevronDown className="w-3 h-3" /> : childCount}
        </button>
      )}
    </div>
  );
}

/* ── Detail Modal ── */
function DetailModal({ member, onClose, allMembers, onSaved }: { member: NetworkMember; onClose: () => void; allMembers: NetworkMember[]; onSaved: () => void | Promise<void> }) {
  const { toast } = useToast();
  const [editingUpline, setEditingUpline] = useState(false);
  const [uplineSearch, setUplineSearch] = useState("");
  const [savingUpline, setSavingUpline] = useState(false);
  const currentSponsorId = member.sponsor_override_id ?? member.sponsor_id;
  const currentSponsor = allMembers.find(m => m.igreen_id === currentSponsorId);
  const uplineOptions = useMemo(() => {
    const q = uplineSearch.trim().toLowerCase();
    return allMembers
      .filter(m => m.igreen_id !== member.igreen_id && !m.id.startsWith("virtual-"))
      .filter(m => !q || m.name.toLowerCase().includes(q) || String(m.igreen_id).includes(q))
      .slice(0, 40);
  }, [allMembers, uplineSearch, member.igreen_id]);

  const setUpline = async (newSponsorId: number | null) => {
    setSavingUpline(true);
    try {
      const { error } = await supabase
        .from("network_members" as any)
        .update({ sponsor_override_id: newSponsorId })
        .eq("id", member.id);
      if (error) throw error;
      toast({ title: "✅ Upline atualizado", description: newSponsorId ? `Agora abaixo de #${newSponsorId}` : "Voltou para o patrocinador original." });
      setEditingUpline(false);
      await onSaved();
      onClose();
    } catch (err) {
      toast({ title: "Erro ao salvar", description: err instanceof Error ? err.message : "Erro", variant: "destructive" });
    } finally {
      setSavingUpline(false);
    }
  };

  const p = getPalette(member.nivel);
  const phone = formatPhone(member.phone);
  const initials = member.name.split(" ").filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md" onClick={onClose}>
      <div
        className="relative bg-card/95 backdrop-blur-xl border border-white/10 rounded-3xl shadow-2xl shadow-black/50
          w-[400px] max-w-[92vw] max-h-[88vh] overflow-y-auto
          animate-in fade-in zoom-in-95 slide-in-from-bottom-4 duration-300"
        onClick={e => e.stopPropagation()}
      >
        {/* Gradient header */}
        <div className={`h-24 bg-gradient-to-br ${p.bg} opacity-20 rounded-t-3xl`} />
        
        {/* Avatar floating on gradient */}
        <div className="flex justify-center -mt-10 relative z-10">
          <div className={`w-20 h-20 rounded-2xl bg-gradient-to-br ${p.bg} ring-4 ring-card
            flex items-center justify-center shadow-2xl ${p.glow}`}>
            <span className="text-xl font-bold text-white drop-shadow-md">{initials}</span>
          </div>
        </div>

        {/* Info */}
        <div className="px-6 pt-3 pb-6">
          <div className="text-center mb-4">
            <h3 className="font-bold text-foreground text-lg leading-tight sensitive-name">{member.name}</h3>
            <p className="text-sm text-muted-foreground mt-0.5">ID {member.igreen_id} • Nível {member.nivel}</p>
          </div>

          {/* Badges */}
          {(member.graduacao || member.graduacao_expansao || member.pro) && (
            <div className="flex flex-wrap justify-center gap-2 mb-5">
              {member.graduacao && (
                <span className="inline-flex items-center gap-1 text-[11px] px-3 py-1 rounded-full bg-primary/10 text-primary font-medium border border-primary/20">
                  <Award className="w-3 h-3" /> {member.graduacao}
                </span>
              )}
              {member.graduacao_expansao && (
                <span className="text-[11px] px-3 py-1 rounded-full bg-primary/10 text-primary font-medium border border-primary/20">
                  {member.graduacao_expansao}
                </span>
              )}
              {member.pro && (
                <span className="text-[11px] px-3 py-1 rounded-full bg-warning/10 text-warning font-medium border border-warning/20">
                  ⚡ PRO
                </span>
              )}
            </div>
          )}

          {/* Stats Grid */}
          <div className="grid grid-cols-3 gap-2 mb-4">
            <MetricCard label="GP" value={Number(member.gp).toLocaleString("pt-BR")} icon={<TrendingUp className="w-3.5 h-3.5" />} color="text-info" />
            <MetricCard label="GI" value={Number(member.gi).toLocaleString("pt-BR")} icon={<Zap className="w-3.5 h-3.5" />} color="text-primary" />
            <MetricCard label="Pontos" value={Number(member.total_pontos).toLocaleString("pt-BR")} icon={<CheckCircle2 className="w-3.5 h-3.5" />} color="text-primary" />
          </div>

          {/* Network Stats */}
          <div className="grid grid-cols-3 gap-2 mb-4">
            <MetricCard label="Clientes" value={String(member.clientes_ativos)} highlight color="text-primary" />
            <MetricCard label="Diretos" value={String(member.qtde_diretos)} color="text-info" />
            <MetricCard label="Dir. Mês" value={String(member.diretos_mes)} color="text-warning" />
          </div>

          <div className="grid grid-cols-2 gap-2 mb-3">
            <MetricCard label="Início Rápido" value={member.inicio_rapido || "—"} color="text-info" />
            <MetricCard
              label={member.sponsor_override_id ? "Upline (manual)" : "Patrocinador"}
              value={currentSponsor ? currentSponsor.name.split(" ")[0] : (currentSponsorId ? String(currentSponsorId) : "—")}
              color={member.sponsor_override_id ? "text-warning" : "text-muted-foreground"}
            />
          </div>

          {/* Editor de upline manual */}
          <div className="mb-5 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
            {!editingUpline ? (
              <button
                onClick={() => setEditingUpline(true)}
                className="w-full text-left text-xs text-muted-foreground hover:text-foreground flex items-center justify-between"
              >
                <span>🔧 Arrumar hierarquia — selecionar quem está acima</span>
                <span className="text-primary">Editar</span>
              </button>
            ) : (
              <div className="space-y-2">
                <p className="text-[11px] text-muted-foreground">Escolha o novo upline (quem fica acima deste licenciado):</p>
                <Input
                  autoFocus
                  placeholder="Buscar por nome ou ID..."
                  value={uplineSearch}
                  onChange={e => setUplineSearch(e.target.value)}
                  className="h-8 text-xs rounded-lg bg-white/[0.04] border-white/[0.08]"
                />
                <div className="max-h-52 overflow-y-auto rounded-lg border border-white/[0.06] divide-y divide-white/[0.04]">
                  {uplineOptions.map(opt => {
                    const isCurrent = opt.igreen_id === currentSponsorId;
                    return (
                      <button
                        key={opt.id}
                        disabled={savingUpline}
                        onClick={() => setUpline(opt.igreen_id)}
                        className={`w-full text-left px-2.5 py-1.5 text-[11px] flex items-center justify-between gap-2 hover:bg-white/[0.06] ${isCurrent ? "bg-primary/10" : ""}`}
                      >
                        <span className="truncate">
                          <strong className="text-foreground">{opt.name}</strong>
                          <span className="text-muted-foreground"> · #{opt.igreen_id} · N{opt.nivel}</span>
                        </span>
                        {isCurrent && <span className="text-[9px] text-primary">atual</span>}
                      </button>
                    );
                  })}
                  {uplineOptions.length === 0 && (
                    <p className="text-[11px] text-muted-foreground text-center py-3">Nenhum licenciado encontrado.</p>
                  )}
                </div>
                <div className="flex items-center gap-2 pt-1">
                  {member.sponsor_override_id != null && (
                    <Button size="sm" variant="outline" disabled={savingUpline} onClick={() => setUpline(null)} className="text-[11px] h-7 rounded-lg">
                      Voltar ao original
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setEditingUpline(false)} className="text-[11px] h-7 rounded-lg ml-auto">
                    Cancelar
                  </Button>
                </div>
              </div>
            )}
          </div>


          {/* Info rows */}
          <div className="space-y-2 mb-5">
            {member.cidade && (
              <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
                <MapPin className="w-4 h-4 text-destructive/70" />
                <span>{member.cidade}{member.uf ? ` / ${member.uf}` : ""}</span>
              </div>
            )}
            {member.data_ativo && (
              <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
                <Calendar className="w-4 h-4 text-info/70" />
                <span>Ativo desde {member.data_ativo}</span>
              </div>
            )}
            {phone && (
              <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
                <Phone className="w-4 h-4 text-primary/70" />
                <span>{phone}</span>
              </div>
            )}
          </div>

          {/* Actions */}
          {member.phone && (
            <Button
              className="w-full gap-2 rounded-xl bg-primary/100 hover:bg-primary text-white h-10 font-semibold shadow-lg shadow-green-500/25"
              onClick={() => openWhatsApp(member.phone)}
            >
              <MessageCircle className="w-4 h-4" /> Abrir WhatsApp
            </Button>
          )}
        </div>

        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-8 h-8 rounded-full bg-black/30 backdrop-blur-sm border border-white/10
            flex items-center justify-center text-white/70 hover:text-white hover:bg-black/50 transition-all"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function MetricCard({ label, value, icon, highlight, color = "text-foreground" }: {
  label: string; value: string; icon?: React.ReactNode; highlight?: boolean; color?: string;
}) {
  return (
    <div className={`rounded-xl p-2.5 text-center border transition-colors
      ${highlight 
        ? "bg-primary/10 border-primary/20" 
        : "bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.06]"
      }`}>
      {icon && <div className={`flex justify-center mb-1 ${color} opacity-60`}>{icon}</div>}
      <span className={`text-base font-bold block ${highlight ? "text-primary" : color}`}>{value}</span>
      <span className="text-[10px] text-muted-foreground block mt-0.5">{label}</span>
    </div>
  );
}

/* ── SVG Connection Lines ── */
function ConnectionLine({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) {
  const midY = (y1 + y2) / 2;
  const d = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
  return (
    <path d={d} fill="none" stroke="url(#line-gradient)" strokeWidth="1.5" opacity="0.4" className="transition-opacity duration-300" />
  );
}

/* ── Org Chart Node ── */
function OrgChartNode({ node, depth = 0, onSelect }: { node: TreeNode; depth?: number; onSelect: (m: NetworkMember) => void }) {
  const [expanded, setExpanded] = useState(depth === 0);
  const hasChildren = node.children.length > 0;

  return (
    <div className="flex flex-col items-center">
      <NodeCard
        member={node.member}
        hasChildren={hasChildren}
        childCount={node.children.length}
        isExpanded={expanded}
        onToggle={() => setExpanded(!expanded)}
        onOpenDetails={() => onSelect(node.member)}
        isOrphan={node.isOrphan}
      />

      {hasChildren && expanded && (
        <>
          {/* Vertical connector */}
          <div className="w-px h-5 bg-gradient-to-b from-white/20 to-white/5" />

          {/* Children row */}
          <div className="flex items-start gap-2 relative">
            {/* Horizontal connector */}
            {node.children.length > 1 && (
              <div
                className="absolute top-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent"
                style={{
                  left: `calc(100% / ${node.children.length * 2})`,
                  right: `calc(100% / ${node.children.length * 2})`,
                }}
              />
            )}
            {node.children.map(child => (
              <div key={child.member.id} className="flex flex-col items-center">
                <div className="w-px h-5 bg-gradient-to-b from-white/15 to-white/5" />
                <OrgChartNode node={child} depth={depth + 1} onSelect={onSelect} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ── Painel lateral: consultor organiza quem fica abaixo de quem ── */
function OrganizeNetworkSheet({
  open,
  onOpenChange,
  members,
  viewerIgreenId,
  consultantId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  members: NetworkMember[];
  viewerIgreenId: number | null;
  consultantId: string;
  onSaved: () => void | Promise<void>;
}) {
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});

  const editable = useMemo(() => {
    return members
      .filter((m) => m.igreen_id !== viewerIgreenId)
      .filter((m) => !m.id.startsWith("virtual-") && !m.id.startsWith("viewer-root-"))
      .sort((a, b) => nameCollator.compare(a.name, b.name));
  }, [members, viewerIgreenId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return editable;
    return editable.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        String(m.igreen_id).includes(q),
    );
  }, [editable, query]);

  const parentOptions = useMemo(() => {
    return members
      .filter((m) => !m.id.startsWith("virtual-"))
      .sort((a, b) => {
        if (a.igreen_id === viewerIgreenId) return -1;
        if (b.igreen_id === viewerIgreenId) return 1;
        return nameCollator.compare(a.name, b.name);
      });
  }, [members, viewerIgreenId]);

  useEffect(() => {
    if (!open) return;
    const next: Record<string, string> = {};
    for (const m of editable) {
      const current = effectiveSponsor(m);
      next[m.id] = current ? String(current) : "";
    }
    setDraft(next);
    setQuery("");
  }, [open, editable]);

  const saveOne = async (member: NetworkMember) => {
    const raw = draft[member.id] ?? "";
    const newSponsorId = raw ? Number(raw) : null;
    if (newSponsorId != null && Number.isNaN(newSponsorId)) return;
    if (newSponsorId === member.igreen_id) {
      toast({ title: "Não pode ficar abaixo de si mesmo", variant: "destructive" });
      return;
    }

    setSavingId(member.id);
    try {
      // null = limpa override e volta ao patrocinador original da iGreen
      const value =
        newSponsorId == null
          ? null
          : newSponsorId === member.sponsor_id
            ? null
            : newSponsorId;

      if (isPersistedMemberId(member.id)) {
        const { error } = await supabase
          .from("network_members" as any)
          .update({ sponsor_override_id: value })
          .eq("id", member.id);
        if (error) throw error;
      } else {
        // Subconta ainda sem linha (ex.: Nilma só na lista de contas) → cria registro mínimo.
        const { error } = await supabase
          .from("network_members" as any)
          .upsert(
            {
              consultant_id: consultantId,
              igreen_id: member.igreen_id,
              name: member.name,
              sponsor_id: member.sponsor_id ?? viewerIgreenId,
              sponsor_override_id: value ?? viewerIgreenId,
              nivel: 1,
              clientes_ativos: member.clientes_ativos || 0,
              gp: member.gp || 0,
              gi: member.gi || 0,
              qtde_diretos: member.qtde_diretos || 0,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "consultant_id,igreen_id" },
          );
        if (error) throw error;
      }

      const parent = parentOptions.find((p) => p.igreen_id === newSponsorId);
      toast({
        title: "Hierarquia salva",
        description: parent
          ? `${member.name.split(" ")[0]} agora abaixo de ${parent.name.split(" ")[0]}`
          : `${member.name.split(" ")[0]} voltou ao patrocinador original`,
      });
      await onSaved();
    } catch (err) {
      toast({
        title: "Erro ao salvar",
        description: err instanceof Error ? err.message : "Erro",
        variant: "destructive",
      });
    } finally {
      setSavingId(null);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col">
        <SheetHeader className="p-5 pb-3 border-b border-border/60 text-left space-y-1">
          <SheetTitle className="flex items-center gap-2 text-base">
            <ListTree className="w-5 h-5 text-primary" />
            Organizar rede
          </SheetTitle>
          <SheetDescription className="text-xs">
            Você (consultor) fica no topo. Escolha quem fica abaixo de quem — a alteração é salva na hora.
          </SheetDescription>
        </SheetHeader>

        <div className="p-4 border-b border-border/40">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar licenciado..."
              className="pl-9 h-9 rounded-xl text-sm"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              Nenhum licenciado para organizar.
            </p>
          ) : (
            filtered.map((m) => {
              const currentId = effectiveSponsor(m);
              const current = parentOptions.find((p) => p.igreen_id === currentId);
              const draftVal = draft[m.id] ?? "";
              const dirty = draftVal !== (currentId ? String(currentId) : "");
              const isManual = m.sponsor_override_id != null;
              return (
                <div
                  key={m.id}
                  className="rounded-xl border border-border/60 bg-card/40 p-3 space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate sensitive-name">{m.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        #{m.igreen_id}
                        {isManual ? " · ajuste manual" : ""}
                      </p>
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      hoje: {current ? current.name.split(" ")[0] : "—"}
                    </span>
                  </div>

                  <label className="block text-[11px] text-muted-foreground">
                    Fica abaixo de:
                  </label>
                  <select
                    className="w-full h-9 rounded-lg border border-input bg-background px-2 text-xs"
                    value={draftVal}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, [m.id]: e.target.value }))
                    }
                  >
                    <option value="">Patrocinador original (iGreen)</option>
                    {parentOptions
                      .filter((p) => p.igreen_id !== m.igreen_id)
                      .map((p) => (
                        <option key={p.id} value={String(p.igreen_id)}>
                          {p.igreen_id === viewerIgreenId ? "★ " : ""}
                          {p.name} (#{p.igreen_id})
                        </option>
                      ))}
                  </select>

                  <Button
                    size="sm"
                    className="w-full h-8 text-xs gap-1.5"
                    disabled={!dirty || savingId === m.id}
                    onClick={() => saveOne(m)}
                  >
                    {savingId === m.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <GitBranch className="w-3.5 h-3.5" />
                    )}
                    {savingId === m.id ? "Salvando…" : "Salvar posição"}
                  </Button>
                </div>
              );
            })
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ── Main Panel ── */
export function NetworkPanel({ consultantId }: NetworkPanelProps) {
  // Hidrata do sessionStorage para nunca mostrar lista vazia ao abrir/F5.
  const [members, setMembers] = useState<NetworkMember[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const cached = sessionStorage.getItem(`network_cache_${consultantId}`);
      if (!cached) return [];
      const parsed = JSON.parse(cached) as NetworkMember[];
      // Sem telefone / data de nascimento no cache (PII).
      return parsed.map((m) => ({ ...m, phone: null, data_nascimento: null }));
    } catch { return []; }
  });
  const [loading, setLoading] = useState(true);
  const fetchAbortRef = useRef<AbortController | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncCooldown, setSyncCooldown] = useState(0);
  const [notConfigured, setNotConfigured] = useState(false);
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"tree" | "table">("tree");
  const [tableVisibleCount, setTableVisibleCount] = useState(200);
  const [zoom, setZoom] = useState(0.85);
  const [zoomTouched, setZoomTouched] = useState(false);
  const [contentSize, setContentSize] = useState({ w: 0, h: 0 });
  const treeScrollRef = useRef<HTMLDivElement>(null);
  const treeInnerRef = useRef<HTMLDivElement>(null);
  const didInitialCenterRef = useRef(false);
  const [selectedMember, setSelectedMember] = useState<NetworkMember | null>(null);
  const [showAccounts, setShowAccounts] = useState(false);
  const [accountCount, setAccountCount] = useState<number | null>(null);
  const [viewerIgreenId, setViewerIgreenId] = useState<number | null>(null);
  const [viewerName, setViewerName] = useState("Você");
  const [subAccountSeeds, setSubAccountSeeds] = useState<SubAccountSeed[]>([]);
  const [organizeOpen, setOrganizeOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ count }, consultantRes, accountsRes] = await Promise.all([
        supabase
          .from("igreen_portal_accounts")
          .select("id", { count: "exact", head: true })
          .eq("consultant_id", consultantId),
        supabase
          .from("consultants")
          .select("name, display_name, igreen_id, igreen_consultor_id")
          .eq("id", consultantId)
          .maybeSingle(),
        supabase
          .from("igreen_portal_accounts")
          .select("position, label, portal_email, igreen_consultor_id")
          .eq("consultant_id", consultantId)
          .order("position", { ascending: true }),
      ]);
      if (cancelled) return;
      setAccountCount(count ?? 0);
      const accounts = (accountsRes.data || []) as Array<{
        position: number;
        label: string | null;
        portal_email: string | null;
        igreen_consultor_id: string | null;
      }>;
      const primary = accounts.find((a) => Number(a.position) === 1);
      const fromPrimary = Number(primary?.igreen_consultor_id || 0);
      const fromConsultant = Number(
        consultantRes.data?.igreen_id || consultantRes.data?.igreen_consultor_id || 0,
      );
      const ownerId = fromPrimary || fromConsultant || null;
      setViewerIgreenId(ownerId);
      const name =
        String(consultantRes.data?.display_name || consultantRes.data?.name || "").trim();
      setViewerName(name || "Você");
      setSubAccountSeeds(
        accounts
          .filter((a) => Number(a.position) > 1)
          .map((a) => ({
            igreenId: Number(a.igreen_consultor_id || 0),
            name: String(a.label || a.portal_email || "").trim() || `Licenciado #${a.igreen_consultor_id}`,
          }))
          .filter((a) => a.igreenId > 0 && a.igreenId !== ownerId),
      );
    })();
    return () => { cancelled = true; };
  }, [consultantId, showAccounts]);


  useEffect(() => {
    const stored = localStorage.getItem("sync_cooldown_until");
    if (stored) {
      const remaining = Math.ceil((parseInt(stored) - Date.now()) / 1000);
      if (remaining > 0) setSyncCooldown(remaining);
    }
  }, []);

  useEffect(() => {
    if (syncCooldown <= 0) return;
    const timer = setInterval(() => {
      setSyncCooldown((prev) => {
        if (prev <= 1) { clearInterval(timer); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [syncCooldown]);

  const startCooldown = () => {
    const seconds = 30;
    setSyncCooldown(seconds);
    localStorage.setItem("sync_cooldown_until", String(Date.now() + seconds * 1000));
  };

  const fetchMembers = useCallback(async () => {
    fetchAbortRef.current?.abort();
    const controller = new AbortController();
    fetchAbortRef.current = controller;
    setLoading(true);
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    let attempt = 0;
    let lastError: unknown = null;
    try {
      while (attempt < 3) {
        if (controller.signal.aborted) return;
        // Colunas explícitas (evita select *) + paginação de rede até esgotar
        const NETWORK_PAGE = 1000;
        const allRows: NetworkMember[] = [];
        let page = 0;
        let pageError: unknown = null;
        while (true) {
          const from = page * NETWORK_PAGE;
          const to = from + NETWORK_PAGE - 1;
          const { data, error } = await supabase
            .from("network_members" as any)
            .select(
              "id,igreen_id,name,phone,sponsor_id,sponsor_override_id,nivel,data_ativo,cidade,uf,clientes_ativos,gp,gi,qtde_diretos,total_pontos,updated_at,graduacao,graduacao_expansao,data_nascimento,gp_total,gi_total,bonificavel,green_points,gp_mes,gi_mes,green_points_mes,diretos_ativos,pro,inicio_rapido,diretos_inicio_rapido,diretos_mes",
            )
            .eq("consultant_id", consultantId)
            .order("nivel", { ascending: true })
            .order("igreen_id", { ascending: true })
            .range(from, to);
          if (controller.signal.aborted) return;
          if (error) {
            pageError = error;
            break;
          }
          const batch = (data as unknown as NetworkMember[]) || [];
          allRows.push(...batch);
          if (batch.length < NETWORK_PAGE) break;
          page++;
        }
        if (!pageError) {
          setMembers(allRows);
          try {
            const cacheSafe = allRows.map((m) => ({ ...m, phone: null, data_nascimento: null }));
            sessionStorage.setItem(`network_cache_${consultantId}`, JSON.stringify(cacheSafe));
          } catch { /* quota */ }
          return;
        }
        lastError = pageError;
        attempt++;
        if (attempt < 3) await sleep(1000 * 2 ** (attempt - 1));
      }
      // Falhou tudo: mantém lista atual (cache) e avisa o usuário.
      console.error("[fetchMembers] falhou após retries — mantendo cache", lastError);
      toast({ title: "Não foi possível atualizar a rede", description: "Mostrando últimos dados em cache. Tente sincronizar.", variant: "destructive" });
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [consultantId]);

  useEffect(() => { fetchMembers(); }, [fetchMembers]);
  useEffect(() => () => { fetchAbortRef.current?.abort(); }, []);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await runIgreenSync(consultantId, "sync_all");
      if (res.ok === false) {
        if (res.reason === "not_configured") {
          setNotConfigured(true);
        } else if (res.reason === "waf_blocked") {
          toast({ title: "Portal temporariamente bloqueado", description: "O escritório iGreen está bloqueando o acesso automático agora. Tente de novo em alguns minutos.", variant: "destructive" });
        } else if (res.reason === "invalid_credentials") {
          toast({ title: "Login iGreen inválido", description: "Confira o e-mail e a senha do escritório iGreen na aba Dados.", variant: "destructive" });
        } else {
          toast({ title: "Erro na sincronização", description: res.error, variant: "destructive" });
        }
        return;
      }
      startCooldown();
      toast({ title: "✅ Rede sincronizada!", description: "Clientes e rede atualizados a partir do portal iGreen." });
      await fetchMembers();
      await queryClient.invalidateQueries({ queryKey: ["analytics", consultantId] });
    } catch (err) {
      toast({ title: "Erro", description: err instanceof Error ? err.message : "Erro", variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  };

  const displayMembers = useMemo(
    () => normalizeMembersForViewer(members, viewerIgreenId, viewerName, subAccountSeeds),
    [members, viewerIgreenId, viewerName, subAccountSeeds],
  );
  const rootMember = useMemo(() => {
    if (viewerIgreenId) {
      const byViewer = displayMembers.find((m) => m.igreen_id === viewerIgreenId);
      if (byViewer) return byViewer;
    }
    return displayMembers.find((m) => m.nivel === 0);
  }, [displayMembers, viewerIgreenId]);
  const totalClientes = useMemo(
    () => displayMembers.reduce((sum, m) => sum + m.clientes_ativos, 0),
    [displayMembers],
  );
  const networkCount = useMemo(() => {
    if (viewerIgreenId) {
      return displayMembers.filter((m) => m.igreen_id !== viewerIgreenId).length;
    }
    return displayMembers.filter((m) => m.nivel > 0).length;
  }, [displayMembers, viewerIgreenId]);
  const tree = useMemo(() => {
    const roots = buildTree(displayMembers);
    if (!viewerIgreenId) return roots;

    const preferredIdx = roots.findIndex((r) => r.member.igreen_id === viewerIgreenId);
    if (preferredIdx < 0) return roots;

    const preferred = roots[preferredIdx];
    const others = roots.filter((_, i) => i !== preferredIdx);
    // Dono da página SEMPRE sozinho no topo; Sirlene/Nilma/órfãos ficam abaixo.
    if (others.length === 0) return [preferred];
    return [{
      ...preferred,
      children: [...preferred.children, ...others],
    }];
  }, [displayMembers, viewerIgreenId]);

  const filtered = useMemo(() => {
    if (!search.trim()) return displayMembers;
    const q = search.toLowerCase();
    return displayMembers.filter(m =>
      m.name.toLowerCase().includes(q) || String(m.igreen_id).includes(q) ||
      (m.cidade || "").toLowerCase().includes(q) || (m.phone || "").includes(q) ||
      (m.uf || "").toLowerCase().includes(q) || (m.graduacao || "").toLowerCase().includes(q)
    );
  }, [displayMembers, search]);

  // Measure intrinsic tree size (independent of zoom) and auto-fit to container width.
  useLayoutEffect(() => {
    if (viewMode !== "tree") return;
    const inner = treeInnerRef.current;
    const container = treeScrollRef.current;
    if (!inner || !container) return;

    const measure = () => {
      // Temporarily neutralize transform to read intrinsic size
      const prev = inner.style.transform;
      inner.style.transform = "none";
      const w = inner.scrollWidth;
      const h = inner.scrollHeight;
      inner.style.transform = prev;
      if (w && h) setContentSize(prev2 => (prev2.w === w && prev2.h === h ? prev2 : { w, h }));

      if (!zoomTouched && w > 0) {
        const cw = container.clientWidth - 16; // breathing room
        const fit = Math.max(0.35, Math.min(1, cw / w));
        setZoom(z => (Math.abs(z - fit) < 0.01 ? z : fit));
      }
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    return () => ro.disconnect();
  }, [tree, viewMode, zoomTouched]);

  // Center horizontally after layout if content overflows
  useLayoutEffect(() => {
    if (viewMode !== "tree") return;
    const container = treeScrollRef.current;
    if (!container || !contentSize.w) return;
    if (didInitialCenterRef.current && zoomTouched) return;
    const scaled = contentSize.w * zoom;
    if (scaled > container.clientWidth) {
      container.scrollLeft = (container.scrollWidth - container.clientWidth) / 2;
    }
    didInitialCenterRef.current = true;
  }, [contentSize, zoom, viewMode, zoomTouched]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <div className="relative">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
          <div className="absolute inset-0 rounded-2xl bg-primary/10 animate-ping" />
        </div>
        <p className="text-sm text-muted-foreground">Carregando rede...</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Detail Modal */}
      {selectedMember && <DetailModal member={selectedMember} onClose={() => setSelectedMember(null)} allMembers={displayMembers} onSaved={fetchMembers} />}

      <OrganizeNetworkSheet
        open={organizeOpen}
        onOpenChange={setOrganizeOpen}
        members={displayMembers}
        viewerIgreenId={viewerIgreenId}
        consultantId={consultantId}
        onSaved={fetchMembers}
      />





      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <GlassCard icon={Users} label="Licenciados" value={networkCount} gradient="from-info to-info" />
        <GlassCard icon={UserCheck} label="Clientes Ativos" value={totalClientes} gradient="from-primary to-primary" />
        <GlassCard icon={TrendingUp} label="GP" value={rootMember ? Number(rootMember.gp).toLocaleString("pt-BR") : "0"} gradient="from-primary to-primary" />
        <GlassCard icon={CheckCircle2} label="GI" value={rootMember ? Number(rootMember.gi).toLocaleString("pt-BR") : "0"} gradient="from-warning to-warning" />
      </div>

      {/* Content */}
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] backdrop-blur-sm overflow-hidden">
        {/* Toolbar */}
        <div className="p-4 border-b border-white/[0.06] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-primary flex items-center justify-center shadow-lg shadow-primary/20">
              <Network className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="font-bold text-foreground text-base tracking-tight">Mapa de Rede</h3>
              <p className="text-xs text-muted-foreground">{displayMembers.length} licenciados • clique para detalhes</p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* View Toggle */}
            <div className="flex items-center rounded-xl bg-white/[0.04] border border-white/[0.08] p-0.5">
              <button onClick={() => setViewMode("tree")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200
                  ${viewMode === "tree" ? "bg-primary/15 text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                <Network className="w-3.5 h-3.5" /> Rede
              </button>
              <button onClick={() => setViewMode("table")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200
                  ${viewMode === "table" ? "bg-primary/15 text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                <Table2 className="w-3.5 h-3.5" /> Tabela
              </button>
            </div>

            {viewMode === "tree" && (
              <div className="flex items-center rounded-xl bg-white/[0.04] border border-white/[0.08] p-0.5">
                <button onClick={() => { setZoomTouched(true); setZoom(z => Math.max(z - 0.15, 0.3)); }} className="px-2 py-1.5 text-muted-foreground hover:text-foreground rounded-lg transition-colors">
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => { setZoomTouched(false); didInitialCenterRef.current = false; }} className="px-2 py-1.5 text-[10px] text-muted-foreground hover:text-foreground font-mono rounded-lg transition-colors" title="Ajustar à tela">
                  {Math.round(zoom * 100)}%
                </button>
                <button onClick={() => { setZoomTouched(true); setZoom(z => Math.min(z + 0.15, 1.5)); }} className="px-2 py-1.5 text-muted-foreground hover:text-foreground rounded-lg transition-colors">
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {viewMode === "table" && (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/40" />
                <Input placeholder="Buscar..." value={search} onChange={e => setSearch(e.target.value)}
                  className="pl-9 h-9 rounded-xl bg-white/[0.04] border-white/[0.08] text-sm w-full sm:w-52 placeholder:text-muted-foreground/40" />
              </div>
            )}

            <Button
              onClick={() => setOrganizeOpen(true)}
              size="sm"
              variant="outline"
              className="gap-1.5 rounded-xl font-semibold h-9 px-4 text-xs border-warning/30 text-warning bg-warning/10 hover:bg-warning/20"
            >
              <ListTree className="w-3.5 h-3.5" />
              Organizar
            </Button>

            <Button onClick={handleSync} size="sm" disabled={syncing || syncCooldown > 0}
              className="gap-1.5 rounded-xl font-semibold h-9 px-4 text-xs bg-primary/10 text-primary border border-primary/20 
                hover:bg-primary/20 hover:border-primary/30 transition-all duration-200 shadow-sm"
              variant="outline">
              {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              {syncing ? "Sincronizando..." : syncCooldown > 0 ? `Aguarde ${syncCooldown}s` : "Sincronizar"}
            </Button>
          </div>
        </div>

        {displayMembers.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-16 h-16 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center mx-auto mb-4">
              <Network className="w-8 h-8 text-muted-foreground/30" />
            </div>
            <p className="text-sm text-muted-foreground mb-4">Nenhum licenciado encontrado.</p>
            <Button onClick={handleSync} size="sm" disabled={syncing || syncCooldown > 0} className="gap-1.5 rounded-xl">
              <RefreshCw className="w-3.5 h-3.5" /> {syncing ? "Sincronizando..." : syncCooldown > 0 ? `Aguarde ${syncCooldown}s` : "Sincronizar agora"}
            </Button>
          </div>
        ) : viewMode === "tree" ? (
          <div ref={treeScrollRef} className="overflow-auto relative" style={{ maxHeight: "72vh" }}>
            {/* Botão lateral fixo — consultor organiza a hierarquia */}
            <button
              type="button"
              onClick={() => setOrganizeOpen(true)}
              className="sticky top-4 float-right mr-3 z-20 flex items-center gap-1.5 rounded-xl border border-warning/40 bg-warning/15 px-3 py-2 text-xs font-semibold text-warning shadow-lg backdrop-blur-sm hover:bg-warning/25"
              title="Organizar quem fica abaixo de quem"
            >
              <ListTree className="w-3.5 h-3.5" />
              Organizar
            </button>

            {/* Background dots pattern */}
            <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{
              backgroundImage: "radial-gradient(circle, currentColor 1px, transparent 1px)",
              backgroundSize: "24px 24px"
            }} />

            <div
              className="mx-auto relative z-10"
              style={{
                width: contentSize.w ? contentSize.w * zoom : undefined,
                height: contentSize.h ? contentSize.h * zoom + 80 : undefined,
              }}
            >
              <div
                ref={treeInnerRef}
                className="flex py-10 px-8"
                style={{
                  transform: `scale(${zoom})`,
                  transformOrigin: "top left",
                  width: contentSize.w || "max-content",
                }}
              >
                {tree.map(root => (
                  <OrgChartNode key={root.member.id} node={root} depth={0} onSelect={setSelectedMember} />
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-white/[0.03] text-muted-foreground text-xs border-b border-white/[0.06]">
                  <th className="text-center px-3 py-3 font-medium w-12">Nível</th>
                  <th className="text-center px-3 py-3 font-medium w-16">ID</th>
                  <th className="text-left px-3 py-3 font-medium">Nome</th>
                  <th className="text-center px-3 py-3 font-medium hidden md:table-cell">Patrocinador</th>
                  <th className="text-center px-3 py-3 font-medium hidden sm:table-cell">Celular</th>
                  <th className="text-center px-3 py-3 font-medium hidden sm:table-cell">Cidade</th>
                  <th className="text-center px-3 py-3 font-medium hidden lg:table-cell">UF</th>
                  <th className="text-center px-3 py-3 font-medium">Cli.</th>
                  <th className="text-center px-3 py-3 font-medium hidden lg:table-cell">GP</th>
                  <th className="text-center px-3 py-3 font-medium hidden lg:table-cell">GI</th>
                  <th className="text-center px-3 py-3 font-medium w-10"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, tableVisibleCount).map((m) => {
                  const p = getPalette(m.nivel);
                  return (
                    <tr key={m.id}
                      className="border-b border-white/[0.04] hover:bg-white/[0.04] transition-colors cursor-pointer group"
                      onClick={() => setSelectedMember(m)}>
                      <td className="text-center px-3 py-3">
                        <span className={`inline-flex items-center justify-center w-7 h-7 rounded-lg text-xs font-bold bg-gradient-to-br ${p.bg} text-white shadow-sm`}>
                          {m.nivel}
                        </span>
                      </td>
                      <td className="text-center px-3 py-3 font-mono text-xs text-muted-foreground">{m.igreen_id}</td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${p.bg} flex items-center justify-center shrink-0`}>
                            <span className="text-[10px] font-bold text-white">
                              {m.name.split(" ").filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase()}
                            </span>
                          </div>
                          <span className="font-medium text-foreground truncate sensitive-name">{m.name}</span>
                        </div>
                      </td>
                      <td className="text-center px-3 py-3 text-xs text-muted-foreground hidden md:table-cell">{m.sponsor_id || "—"}</td>
                      <td className="text-center px-3 py-3 text-xs text-muted-foreground hidden sm:table-cell">{formatPhone(m.phone) || "—"}</td>
                      <td className="text-center px-3 py-3 text-xs text-muted-foreground hidden sm:table-cell">{m.cidade || "—"}</td>
                      <td className="text-center px-3 py-3 text-xs text-muted-foreground hidden lg:table-cell">{m.uf || "—"}</td>
                      <td className="text-center px-3 py-3">
                        <span className={`inline-flex items-center justify-center min-w-[28px] h-6 rounded-full text-xs font-bold
                          ${m.clientes_ativos > 0 ? "bg-primary/15 text-primary" : "bg-white/5 text-muted-foreground"}`}>
                          {m.clientes_ativos}
                        </span>
                      </td>
                      <td className="text-center px-3 py-3 text-xs hidden lg:table-cell font-medium">{Number(m.gp).toLocaleString("pt-BR")}</td>
                      <td className="text-center px-3 py-3 text-xs hidden lg:table-cell font-medium">{Number(m.gi).toLocaleString("pt-BR")}</td>
                      <td className="text-center px-3 py-3">
                        {m.phone && (
                          <button onClick={e => { e.stopPropagation(); openWhatsApp(m.phone); }}
                            className="p-1.5 rounded-lg hover:bg-primary/15 opacity-0 group-hover:opacity-100 transition-all" title="WhatsApp">
                            <MessageCircle className="w-4 h-4 text-primary" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filtered.length > tableVisibleCount && (
              <div className="flex justify-center py-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setTableVisibleCount((n) => n + 200)}
                >
                  Carregar mais ({tableVisibleCount} de {filtered.length})
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      <Dialog open={notConfigured} onOpenChange={(o) => !o && setNotConfigured(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-primary" /> Conecte seu Escritório iGreen
            </DialogTitle>
            <DialogDescription className="pt-2">
              Para sincronizar seus clientes e rede, informe o e-mail e a senha do
              escritório iGreen na aba <b>Dados</b>. A sincronização passa a ser automática.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button onClick={() => { setNotConfigured(false); window.dispatchEvent(new CustomEvent("open-admin-settings")); }}>
              <KeyRound className="w-4 h-4 mr-2" /> Abrir aba Dados
            </Button>
            <Button variant="outline" onClick={() => setNotConfigured(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ── Glass Summary Card ── */
function GlassCard({ icon: Icon, label, value, gradient }: { icon: any; label: string; value: number | string; gradient: string }) {
  return (
    <div className="relative rounded-2xl border border-white/[0.06] bg-white/[0.02] backdrop-blur-sm p-4 overflow-hidden group hover:border-white/[0.12] transition-all duration-300">
      {/* Subtle glow */}
      <div className={`absolute -top-8 -right-8 w-24 h-24 rounded-full bg-gradient-to-br ${gradient} opacity-[0.06] blur-2xl group-hover:opacity-[0.12] transition-opacity duration-500`} />
      
      <div className="relative z-10">
        <div className="flex items-center gap-2 mb-2">
          <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${gradient} flex items-center justify-center shadow-lg`}>
            <Icon className="w-4 h-4 text-white" />
          </div>
          <span className="text-xs text-muted-foreground font-medium">{label}</span>
        </div>
        <p className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight">{value}</p>
      </div>
    </div>
  );
}
