import { useState, useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { PaginatedList } from "@/components/ui/PaginatedList";
import {
  UserPlus, Users, Search, Loader2, RefreshCw, Filter, Smartphone, Zap, MoreVertical,
  Chrome, ExternalLink, KeyRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { requestSync as requestExtSync, type SyncResult } from "@/lib/igreenExtensionBridge";
import { getProfilePicture } from "@/services/evolutionApi";
import { AddCustomerDialog } from "./AddCustomerDialog";
import { CustomerListItem } from "./CustomerListItem";
import { CustomerEditDialog } from "./CustomerEditDialog";
import { CustomerImportExport } from "./CustomerImportExport";
import { useCustomerDeals } from "@/hooks/useCustomerDeals";
import {
  type Customer, type StatusFilter,
  isDevolutiva, buildWhatsAppMessage,
} from "./customerUtils";

interface CustomerManagerProps {
  customers: Customer[];
  consultantId: string;
  onCustomersChange: () => void;
  instanceName?: string | null;
  onOpenChat?: (phone: string, suggestedMessage?: string) => void;
}

export function CustomerManager({ customers, consultantId, onCustomersChange, instanceName, onOpenChat }: CustomerManagerProps) {
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [profilePics, setProfilePics] = useState<Record<string, string>>({});
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selectedLicenciado, setSelectedLicenciado] = useState("all");
  const [selectedDistribuidora, setSelectedDistribuidora] = useState("all");
  const [selectedCidade, setSelectedCidade] = useState("all");
  const [selectedTipo, setSelectedTipo] = useState<
    "all" | "energia" | "telefonia" | "solar" | "placas" | "seguros"
  >("all");
  const [syncing, setSyncing] = useState(false);
  const [syncCooldown, setSyncCooldown] = useState(0);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [extDialog, setExtDialog] = useState<null | "no_extension" | "no_token" | "not_logged_in" | "failed">(null);
  const [extDialogMsg, setExtDialogMsg] = useState("");

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const dealsByCustomer = useCustomerDeals(consultantId, customers);

  // Fetch last sync timestamp
  useEffect(() => {
    supabase.from("settings").select("value").eq("key", "last_igreen_sync").maybeSingle().then(({ data }) => {
      if (data?.value) setLastSync(data.value);
    });
  }, []);

  // Cooldown timer
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

  async function handleSyncIgreen() {
    setSyncing(true);
    try {
      const res: SyncResult = await requestExtSync();
      if (res.ok === false) {
        if (res.reason === "no_extension") {
          setExtDialogMsg("Não detectamos a extensão iGreen Sync neste navegador. Instale a extensão para sincronizar seus clientes e rede com 1 clique.");
          setExtDialog("no_extension");
        } else if (res.reason === "no_token") {
          setExtDialogMsg("A extensão está instalada mas ainda não foi pareada. Gere um token na aba Dados e cole na extensão.");
          setExtDialog("no_token");
        } else if (res.reason === "not_logged_in") {
          setExtDialogMsg("Você precisa estar logado no escritório iGreen em outra aba deste mesmo navegador para a extensão conseguir baixar seus dados.");
          setExtDialog("not_logged_in");
        } else {
          setExtDialogMsg(res.error || "Falha ao sincronizar. Tente novamente em alguns segundos.");
          setExtDialog("failed");
        }
        return;
      }
      startCooldown();
      const syncedAt = new Date().toISOString();
      setLastSync(syncedAt);
      toast({ title: "✅ Sincronização concluída!", description: "Clientes e rede atualizados a partir do portal iGreen." });
      onCustomersChange();
      await queryClient.invalidateQueries({ queryKey: ["analytics", consultantId] });
    } catch (err) {
      toast({ title: "Erro na sincronização", description: err instanceof Error ? err.message : "Erro", variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  }

  const licenciadoOptions = useMemo(() => {
    const names = new Set<string>();
    for (const c of customers) {
      if (c.registered_by_name) names.add(c.registered_by_name);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [customers]);

  const distribuidoraOptions = useMemo(() => {
    const names = new Set<string>();
    for (const c of customers) {
      if (c.distribuidora) names.add(c.distribuidora);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [customers]);

  const cidadeOptions = useMemo(() => {
    const names = new Set<string>();
    for (const c of customers) {
      const label = [c.address_city, c.address_state].filter(Boolean).join(" - ");
      if (label) names.add(label);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [customers]);

  const searchFiltered = search.trim()
    ? customers.filter(
        (c) =>
          (c.name || "").toLowerCase().includes(search.toLowerCase()) ||
          c.phone_whatsapp.includes(search) ||
          (c.email || "").toLowerCase().includes(search.toLowerCase()) ||
          (c.cpf || "").includes(search)
      )
    : customers;

  const tipoFiltered = selectedTipo === "all"
    ? searchFiltered
    : searchFiltered.filter((c) => (c.tipo_produto || "energia") === selectedTipo);

  const licenciadoFiltered = selectedLicenciado === "all"
    ? tipoFiltered
    : tipoFiltered.filter((c) => (c.registered_by_name || "Sem licenciado") === selectedLicenciado);

  const distribuidoraFiltered = selectedDistribuidora === "all"
    ? licenciadoFiltered
    : licenciadoFiltered.filter((c) => (c.distribuidora || "") === selectedDistribuidora);

  const cidadeFiltered = selectedCidade === "all"
    ? distribuidoraFiltered
    : distribuidoraFiltered.filter((c) => {
        const label = [c.address_city, c.address_state].filter(Boolean).join(" - ");
        return label === selectedCidade;
      });

  const filtered = statusFilter === "all"
    ? cidadeFiltered
    : statusFilter === "devolutiva"
    ? cidadeFiltered.filter((c) => c.status === "devolutiva" || isDevolutiva(c))
    : cidadeFiltered.filter((c) => c.status === statusFilter);

  async function handleDelete(id: string) {
    try {
      const { error } = await supabase.from("customers").delete().eq("id", id);
      if (error) throw error;
      toast({ title: "Cliente removido" });
      onCustomersChange();
    } catch (err) {
      toast({ title: "Erro", description: err instanceof Error ? err.message : "Erro", variant: "destructive" });
    }
  }

  function handleCopyMessage(customer: Customer) {
    const msg = buildWhatsAppMessage(customer);
    navigator.clipboard.writeText(msg);
    toast({ title: "📋 Mensagem copiada!", description: "Cole no WhatsApp para enviar" });
  }

  function handleOpenWhatsApp(customer: Customer) {
    const phone = customer.phone_whatsapp.replace(/\D/g, "");
    const msg = buildWhatsAppMessage(customer);
    if (onOpenChat) {
      onOpenChat(phone, msg);
    } else {
      const encoded = encodeURIComponent(msg);
      window.open(`https://wa.me/${phone}?text=${encoded}`, "_blank");
    }
  }

  function handleExpandToggle(customerId: string) {
    const willExpand = expandedId !== customerId;
    setExpandedId(willExpand ? customerId : null);
    if (willExpand && instanceName && !profilePics[customerId]) {
      const c = customers.find((cu) => cu.id === customerId);
      if (c) {
        const phone = c.phone_whatsapp.replace(/\D/g, "");
        if (phone.length >= 10) {
          getProfilePicture(instanceName, `${phone}@s.whatsapp.net`)
            .then((url) => { if (url && typeof url === "string") setProfilePics((prev) => ({ ...prev, [customerId]: url })); })
            .catch(() => {});
        }
      }
    }
  }

  const filterButtons: { key: StatusFilter; label: string; count: number; color: string }[] = [
    { key: "all", label: "Todos", count: customers.length, color: "text-foreground" },
    { key: "approved", label: "Aprovados", count: customers.filter((c) => c.status === "approved").length, color: "text-primary" },
    { key: "awaiting_signature", label: "Falta Assinatura", count: customers.filter((c) => c.status === "awaiting_signature").length, color: "text-warning" },
    { key: "pending", label: "Pendentes", count: customers.filter((c) => c.status === "pending").length, color: "text-warning" },
    { key: "devolutiva", label: "Devolutiva", count: customers.filter((c) => c.status === "devolutiva" || isDevolutiva(c)).length, color: "text-destructive" },
    { key: "rejected", label: "Reprovados", count: customers.filter((c) => c.status === "rejected").length, color: "text-destructive" },
    { key: "lead", label: "Clientes interessados", count: customers.filter((c) => c.status === "lead").length, color: "text-info" },
  ];

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-card">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.03] via-transparent to-info/[0.02] pointer-events-none" />

      <div className="relative">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 sm:p-5 pb-3 sm:pb-4 border-b border-border/50 gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center border border-primary/15 shadow-lg shadow-primary/5 shrink-0">
              <Users className="w-5 h-5 text-primary" />
            </div>
            <div className="min-w-0">
              <h3 className="font-bold text-foreground text-base sm:text-lg tracking-tight">
                Clientes
                <span className="ml-2 text-sm font-normal text-muted-foreground">({customers.length})</span>
              </h3>
              <p className="text-[11px] text-muted-foreground truncate">
                Gerencie sua carteira
                {lastSync && <span className="hidden sm:inline ml-2 text-muted-foreground/60">• Última sync: {new Date(lastSync).toLocaleString("pt-BR")}</span>}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button onClick={() => setShowAddDialog(true)} size="sm" className="gap-1.5 rounded-xl font-semibold shadow-lg shadow-primary/15 h-9 px-3.5 text-sm">
              <UserPlus className="w-4 h-4" /> <span>Novo</span><span className="hidden sm:inline">&nbsp;cliente</span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-9 w-9 p-0 rounded-xl" aria-label="Mais ações">
                  <MoreVertical className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem onSelect={(e) => { e.preventDefault(); if (!syncing && syncCooldown === 0) handleSyncIgreen(); }} disabled={syncing || syncCooldown > 0}>
                  {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  {syncing ? "Sincronizando..." : syncCooldown > 0 ? `Aguarde ${syncCooldown}s` : "Sincronizar iGreen"}
                </DropdownMenuItem>
                <CustomerImportExport
                  asMenuItems
                  customers={customers}
                  filtered={filtered}
                  consultantId={consultantId}
                  onCustomersChange={onCustomersChange}
                />
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Search & Filters */}
        <div className="px-4 sm:px-5 pt-3 sm:pt-4 pb-2 sm:pb-3 space-y-2">
          <div className="space-y-3">
            {/* Search bar */}
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
              <Input placeholder="Buscar nome, telefone, CPF, e-mail..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10 h-10 sm:h-11 rounded-xl bg-secondary/30 border-border/50 focus:border-primary/40 text-sm" />
            </div>

            {/* Tipo produto toggle */}
            <div className="flex flex-wrap gap-1 bg-secondary/30 rounded-lg p-1 border border-border/40 w-full sm:w-fit">
              {([
                ["all", "Todos", "📊"],
                ["energia", "Energia", "⚡"],
                ["telefonia", "Telecom", "📱"],
                ["solar", "Conexão Solar", "☀️"],
                ["placas", "Conexão Placas", "🔋"],
                ["seguros", "Seguro", "🛡️"],
              ] as const).map(([val, label, icon]) => (
                <button
                  key={val}
                  onClick={() => setSelectedTipo(val as any)}
                  className={`inline-flex items-center justify-center gap-1.5 text-xs font-semibold rounded-md py-1.5 px-3 transition-all duration-200 ${
                    selectedTipo === val
                      ? "bg-primary text-white shadow-sm"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                  }`}
                >
                  <span className="text-sm">{icon}</span>
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-2 grid-cols-1 sm:grid-cols-3">

            <Select value={selectedLicenciado} onValueChange={setSelectedLicenciado}>
              <SelectTrigger className="h-8 sm:h-9 rounded-xl bg-secondary/30 border-border/50 text-xs">
                <div className="flex items-center gap-1.5 truncate">
                  <Filter className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <SelectValue placeholder="Licenciado" />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos licenciados</SelectItem>
                {licenciadoOptions.map((name) => (
                  <SelectItem key={name} value={name}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={selectedDistribuidora} onValueChange={setSelectedDistribuidora}>
              <SelectTrigger className="h-8 sm:h-9 rounded-xl bg-secondary/30 border-border/50 text-xs">
                <div className="flex items-center gap-1.5 truncate">
                  <Zap className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <SelectValue placeholder="Distribuidora" />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas distribuidoras</SelectItem>
                {distribuidoraOptions.map((name) => (
                  <SelectItem key={name} value={name}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={selectedCidade} onValueChange={setSelectedCidade}>
              <SelectTrigger className="h-9 sm:h-9 rounded-xl bg-secondary/30 border-border/50 text-xs">
                <div className="flex items-center gap-1.5 truncate">
                  <Smartphone className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <SelectValue placeholder="Cidade/UF" />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas cidades</SelectItem>
                {cidadeOptions.map((name) => (
                  <SelectItem key={name} value={name}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Clickable Status Filters */}
        <div className="flex gap-2 px-4 sm:px-5 pb-3 sm:pb-4 overflow-x-auto no-scrollbar" style={{ WebkitOverflowScrolling: 'touch' }}>
          {filterButtons.map((f) => (
            <button
              key={f.key}
              onClick={() => setStatusFilter(f.key)}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-medium transition-all border shrink-0 ${
                statusFilter === f.key
                  ? "border-primary/50 bg-primary/10 text-foreground shadow-sm"
                  : "border-border bg-secondary/30 hover:bg-secondary/60 text-muted-foreground hover:text-foreground"
              }`}
            >
              <span className={`text-base font-bold tabular-nums ${statusFilter === f.key ? "text-primary" : f.color}`}>{f.count}</span>
              <span>{f.label}</span>
            </button>
          ))}
        </div>

        {/* List with pagination */}
        <div className="px-4 sm:px-5 pb-5">
          <PaginatedList
            items={filtered}
            pageSize={20}
            flow
            renderEmpty={() => (
              <div className="text-center py-16">
                <div className="w-16 h-16 rounded-2xl bg-secondary/50 flex items-center justify-center mx-auto mb-3">
                  <Users className="w-7 h-7 text-muted-foreground/30" />
                </div>
                <p className="text-sm text-muted-foreground">{customers.length === 0 ? "Nenhum cliente cadastrado" : "Nenhum resultado"}</p>
              </div>
            )}
            renderItem={(c) => (
              <CustomerListItem
                key={c.id}
                customer={c}
                isExpanded={expandedId === c.id}
                profilePic={profilePics[c.id]}
                deal={dealsByCustomer[c.id]}
                onToggleExpand={() => handleExpandToggle(c.id)}
                onEdit={() => setEditingCustomer(c)}
                onDelete={() => handleDelete(c.id)}
                onOpenWhatsApp={() => handleOpenWhatsApp(c)}
                onCopyMessage={() => handleCopyMessage(c)}
              />
            )}
          />
        </div>
      </div>

      <AddCustomerDialog open={showAddDialog} onOpenChange={setShowAddDialog} phone="" name={null} consultantId={consultantId} onAdded={onCustomersChange} />

      <CustomerEditDialog
        customer={editingCustomer}
        onClose={() => setEditingCustomer(null)}
        onSaved={onCustomersChange}
      />

      <Dialog open={extDialog !== null} onOpenChange={(o) => !o && setExtDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {extDialog === "not_logged_in" ? <KeyRound className="w-5 h-5 text-primary" /> : <Chrome className="w-5 h-5 text-primary" />}
              {extDialog === "no_extension" && "Instale a extensão iGreen Sync"}
              {extDialog === "no_token" && "Extensão sem pareamento"}
              {extDialog === "not_logged_in" && "Faça login no escritório iGreen"}
              {extDialog === "failed" && "Falha na sincronização"}
            </DialogTitle>
            <DialogDescription className="pt-2">{extDialogMsg}</DialogDescription>
          </DialogHeader>
          {extDialog === "not_logged_in" && (
            <div className="text-xs text-muted-foreground rounded-lg border border-border bg-muted/40 p-3">
              <strong>Como resolver:</strong> abra <code>escritorio.igreenenergy.com.br</code> em outra aba, faça login (resolva o captcha se aparecer) e volte aqui para clicar em <b>Sincronizar iGreen</b> novamente.
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-2">
            {extDialog === "not_logged_in" && (
              <Button asChild>
                <a href="https://escritorio.igreenenergy.com.br/" target="_blank" rel="noreferrer">
                  <ExternalLink className="w-4 h-4 mr-2" /> Abrir escritório iGreen
                </a>
              </Button>
            )}
            {(extDialog === "no_extension" || extDialog === "no_token") && (
              <Button onClick={() => { setExtDialog(null); window.dispatchEvent(new CustomEvent("open-admin-settings")); }}>
                <Chrome className="w-4 h-4 mr-2" /> Abrir extensão no painel
              </Button>
            )}
            <Button variant="outline" onClick={() => setExtDialog(null)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
