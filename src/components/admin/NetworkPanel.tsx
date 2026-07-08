import { useState, useEffect, useMemo, useCallback, useRef, useLayoutEffect, lazy, Suspense } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Users, UserCheck, TrendingUp, CheckCircle2, RefreshCw, Loader2, Search, MessageCircle, Table2, Network, ZoomIn, ZoomOut, MapPin, Calendar, Phone, X, ChevronDown, Zap, Award, ExternalLink, KeyRound, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
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

function getRemainingDirectSlots(node: TreeNode) {
  if (node.member.id.startsWith("virtual-")) return Number.POSITIVE_INFINITY;
  return (node.member.qtde_diretos || 0) - node.children.length;
}

function buildTree(members: NetworkMember[]): TreeNode[] {
  const byId = new Map<number, TreeNode>();
  const nodesByLevel = new Map<number, TreeNode[]>();
  const membersSorted = [...members].sort((a, b) => a.nivel - b.nivel || a.igreen_id - b.igreen_id);
  const registerByLevel = (node: TreeNode) => {
    const levelNodes = nodesByLevel.get(node.member.nivel) || [];
    levelNodes.push(node);
    nodesByLevel.set(node.member.nivel, levelNodes);
  };

  membersSorted.forEach((m) => {
    const node = { member: m, children: [], isOrphan: false };
    byId.set(m.igreen_id, node);
    registerByLevel(node);
  });

  const roots: TreeNode[] = [];
  const orphanGroups = new Map<number, TreeNode[]>();

  membersSorted.forEach((m) => {
    const node = byId.get(m.igreen_id)!;
    const sponsor = effectiveSponsor(m);
    if (sponsor && byId.has(sponsor)) {
      byId.get(sponsor)!.children.push(node);
    } else if (m.nivel === 0 || !sponsor) {
      roots.push(node);
    } else {
      node.isOrphan = true;
      const grouped = orphanGroups.get(sponsor) || [];
      grouped.push(node);
      orphanGroups.set(sponsor, grouped);
    }
  });

  const pickBestParent = (virtualLevel: number, sponsorId: number) => {
    for (let candidateLevel = virtualLevel - 1; candidateLevel >= 0; candidateLevel -= 1) {
      const candidates = (nodesByLevel.get(candidateLevel) || []).filter((candidate) => candidate.member.id !== `virtual-${sponsorId}`);
      if (!candidates.length) continue;

      const ranked = [...candidates].sort((a, b) => {
        const aRemaining = getRemainingDirectSlots(a);
        const bRemaining = getRemainingDirectSlots(b);

        const aCapacityPenalty = aRemaining > 0 ? 0 : Math.abs(aRemaining) * 10000 + 5000;
        const bCapacityPenalty = bRemaining > 0 ? 0 : Math.abs(bRemaining) * 10000 + 5000;
        if (aCapacityPenalty !== bCapacityPenalty) return aCapacityPenalty - bCapacityPenalty;

        const aDistance = Math.abs(a.member.igreen_id - sponsorId);
        const bDistance = Math.abs(b.member.igreen_id - sponsorId);
        if (aDistance !== bDistance) return aDistance - bDistance;

        return b.member.nivel - a.member.nivel;
      });

      if (ranked[0]) return ranked[0];
    }

    return roots[0] || null;
  };

  if (orphanGroups.size > 0) {
    const orderedGroups = Array.from(orphanGroups.entries()).sort((a, b) => {
      const aLevel = (a[1][0]?.member.nivel || 1) - 1;
      const bLevel = (b[1][0]?.member.nivel || 1) - 1;
      return aLevel - bLevel || a[0] - b[0];
    });

    for (const [sponsorId, children] of orderedGroups) {
      const virtualLevel = Math.max(0, (children[0]?.member.nivel || 1) - 1);
      const virtualMember: NetworkMember = {
        id: `virtual-${sponsorId}`,
        igreen_id: sponsorId,
        name: `Patrocinador Externo #${sponsorId}`,
        phone: null,
        sponsor_id: null,
        nivel: virtualLevel,
        data_ativo: null,
        cidade: null,
        uf: null,
        clientes_ativos: 0,
        gp: 0,
        gi: 0,
        qtde_diretos: children.length,
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
      };

      const virtualNode: TreeNode = { member: virtualMember, children, isOrphan: true };
      const parent = pickBestParent(virtualLevel, sponsorId);

      if (parent) {
        parent.children.push(virtualNode);
      } else {
        roots.push(virtualNode);
      }

      registerByLevel(virtualNode);
    }
  }

  sortNodes(roots);
  return roots;
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

/* ── Main Panel ── */
export function NetworkPanel({ consultantId }: NetworkPanelProps) {
  // Hidrata do sessionStorage para nunca mostrar lista vazia ao abrir/F5.
  const [members, setMembers] = useState<NetworkMember[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const cached = sessionStorage.getItem(`network_cache_${consultantId}`);
      return cached ? (JSON.parse(cached) as NetworkMember[]) : [];
    } catch { return []; }
  });
  const [loading, setLoading] = useState(true);
  const fetchAbortRef = useRef<AbortController | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncCooldown, setSyncCooldown] = useState(0);
  const [notConfigured, setNotConfigured] = useState(false);
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"tree" | "table">("tree");
  const [zoom, setZoom] = useState(0.85);
  const [zoomTouched, setZoomTouched] = useState(false);
  const [contentSize, setContentSize] = useState({ w: 0, h: 0 });
  const treeScrollRef = useRef<HTMLDivElement>(null);
  const treeInnerRef = useRef<HTMLDivElement>(null);
  const didInitialCenterRef = useRef(false);
  const [selectedMember, setSelectedMember] = useState<NetworkMember | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

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
        const { data, error } = await supabase
          .from("network_members" as any)
          .select("*")
          .eq("consultant_id", consultantId)
          .order("nivel", { ascending: true })
          .order("igreen_id", { ascending: true });
        if (controller.signal.aborted) return;
        if (!error) {
          const list = (data as unknown as NetworkMember[]) || [];
          setMembers(list);
          try { sessionStorage.setItem(`network_cache_${consultantId}`, JSON.stringify(list)); } catch { /* quota */ }
          return;
        }
        lastError = error;
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

  const rootMember = useMemo(() => members.find(m => m.nivel === 0), [members]);
  const totalClientes = useMemo(() => members.reduce((sum, m) => sum + m.clientes_ativos, 0), [members]);
  const networkCount = useMemo(() => members.filter(m => m.nivel > 0).length, [members]);
  const tree = useMemo(() => buildTree(members), [members]);

  const filtered = useMemo(() => {
    if (!search.trim()) return members;
    const q = search.toLowerCase();
    return members.filter(m =>
      m.name.toLowerCase().includes(q) || String(m.igreen_id).includes(q) ||
      (m.cidade || "").toLowerCase().includes(q) || (m.phone || "").includes(q) ||
      (m.uf || "").toLowerCase().includes(q) || (m.graduacao || "").toLowerCase().includes(q)
    );
  }, [members, search]);

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
      {selectedMember && <DetailModal member={selectedMember} onClose={() => setSelectedMember(null)} allMembers={members} onSaved={fetchMembers} />}

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
              <p className="text-xs text-muted-foreground">{members.length} licenciados • clique para detalhes</p>
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

            <Button onClick={handleSync} size="sm" disabled={syncing || syncCooldown > 0}
              className="gap-1.5 rounded-xl font-semibold h-9 px-4 text-xs bg-primary/10 text-primary border border-primary/20 
                hover:bg-primary/20 hover:border-primary/30 transition-all duration-200 shadow-sm"
              variant="outline">
              {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              {syncing ? "Sincronizando..." : syncCooldown > 0 ? `Aguarde ${syncCooldown}s` : "Sincronizar"}
            </Button>
          </div>
        </div>

        {members.length === 0 ? (
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
                {filtered.map((m, i) => {
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
