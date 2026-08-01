import { useState, useEffect, useMemo, useRef } from "react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { PaginatedList } from "@/components/ui/PaginatedList";
import {
  UserPlus, Users, Search, Loader2, RefreshCw, Filter, Smartphone, Zap, MoreVertical,
  KeyRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { runIgreenSync, waitIgreenSyncFinished } from "@/lib/igreenSync";
import { getProfilePicture } from "@/services/evolutionApi";
import { AddCustomerDialog } from "./AddCustomerDialog";
import { CustomerListItem } from "./CustomerListItem";
import { CustomerEditDialog } from "./CustomerEditDialog";
import { CustomerImportExport } from "./CustomerImportExport";
import { useCustomerDeals } from "@/hooks/useCustomerDeals";
import { useMyClientsSettings } from "@/hooks/useMyClientsSettings";
import { useNetworkLicenciados } from "@/hooks/useNetworkLicenciados";
import { IGreenSyncStatusBar } from "@/components/admin/IGreenSyncStatusBar";
import { filterMyClients } from "@/lib/myClientsFilter";
import {
  type Customer, type StatusFilter,
  isDevolutiva, buildWhatsAppMessage,
} from "./customerUtils";


interface CustomerManagerProps {
  customers: Customer[];
  consultantId: string;
  consultantIgreenId?: string;
  consultantName?: string;
  onCustomersChange: () => void;
  instanceName?: string | null;
  onOpenChat?: (phone: string, suggestedMessage?: string) => void;
}

export function CustomerManager({
  customers,
  consultantId,
  consultantIgreenId,
  consultantName,
  onCustomersChange,
  instanceName,
  onOpenChat,
}: CustomerManagerProps) {
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
  const [notConfigured, setNotConfigured] = useState(false);

  const { toast } = useToast();
  const syncAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      syncAbortRef.current?.abort();
    };
  }, []);
  const queryClient = useQueryClient();
  const refreshIgreenQueries = async () => {
    onCustomersChange();
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["analytics"] }),
      queryClient.invalidateQueries({ queryKey: ["cm-telecom", consultantId] }),
      queryClient.invalidateQueries({ queryKey: ["cm-seguros", consultantId] }),
      queryClient.invalidateQueries({ queryKey: ["ct-telecom", consultantId] }),
      queryClient.invalidateQueries({ queryKey: ["ct-seguros", consultantId] }),
      queryClient.invalidateQueries({ queryKey: ["igreen-telecom", consultantId] }),
      queryClient.invalidateQueries({ queryKey: ["igreen-seguros", consultantId] }),
      queryClient.invalidateQueries({ queryKey: ["igreen-telecom-clientes", consultantId] }),
      queryClient.invalidateQueries({ queryKey: ["igreen-seguros-clientes", consultantId] }),
      queryClient.invalidateQueries({ queryKey: ["igreen-consultant-metrics", consultantId] }),
      queryClient.invalidateQueries({ queryKey: ["network-licenciados", consultantId] }),
      queryClient.invalidateQueries({ queryKey: ["network-igreen-ids", consultantId] }),
      queryClient.invalidateQueries({ queryKey: ["igreen-sync-status", consultantId] }),
      queryClient.invalidateQueries({ queryKey: ["my-clients-settings", consultantId] }),
    ]);
  };
  const { data: myClientsSettings, isPending: myClientsSettingsLoading } = useMyClientsSettings(consultantId, {
    myIgreenId: consultantIgreenId || null,
    consultantName: consultantName ?? null,
    cadastroIgreenIds: [],
  });
  const energiaBase = useMemo(() => {
    if (myClientsSettings) return filterMyClients(customers, myClientsSettings);
    // Enquanto as regras de "meus clientes" carregam, não vazar a base inteira.
    if (myClientsSettingsLoading && consultantId) return [];
    return customers;
  }, [customers, myClientsSettings, myClientsSettingsLoading, consultantId]);


  // Telecom (iGreen) — clientes do consultor vindos da tabela dedicada
  const { data: telecomRows = [] } = useQuery({
    queryKey: ["cm-telecom", consultantId],
    enabled: !!consultantId,
    staleTime: 60_000,
    queryFn: async () => {
      type Row = {
        id: string; nome: string | null; numero: string | null;
        cidade: string | null; uf: string | null; licenciado: string | null;
        status_label: string | null; status: string | null; synced_at: string | null;
      };
      // Paginação real: o antigo .limit(2000) truncava a carteira sem aviso.
      const PAGE = 1000;
      const out: Row[] = [];
      for (let page = 0; page < 30; page++) {
        const { data, error } = await supabase
          .from("igreen_telecom_customers" as never)
          .select("id, nome, numero, cidade, uf, licenciado, status_label, status, synced_at")
          .eq("consultant_id", consultantId)
          .order("id", { ascending: true })
          .range(page * PAGE, page * PAGE + PAGE - 1);
        if (error) { console.error("[CustomerManager] telecom", error); break; }
        const rows = (data || []) as unknown as Row[];
        out.push(...rows);
        if (rows.length < PAGE) break;
      }
      return out;
    },
  });

  // Seguros (iGreen)
  const { data: segurosRows = [] } = useQuery({
    queryKey: ["cm-seguros", consultantId],
    enabled: !!consultantId,
    staleTime: 60_000,
    queryFn: async () => {
      type Row = {
        id: string; segurado: string | null; modelo: string | null; placa: string | null;
        cidade: string | null; uf: string | null; licenciado: string | null;
        status_label: string | null; status: string | null; mensal: number | null; synced_at: string | null;
      };
      const PAGE = 1000;
      const out: Row[] = [];
      for (let page = 0; page < 30; page++) {
        const { data, error } = await supabase
          .from("igreen_seguros_customers" as never)
          .select("id, segurado, modelo, placa, cidade, uf, licenciado, status_label, status, mensal, synced_at")
          .eq("consultant_id", consultantId)
          .order("id", { ascending: true })
          .range(page * PAGE, page * PAGE + PAGE - 1);
        if (error) { console.error("[CustomerManager] seguros", error); break; }
        const rows = (data || []) as unknown as Row[];
        out.push(...rows);
        if (rows.length < PAGE) break;
      }
      return out;
    },
  });


  const telecomAsCustomers = useMemo<Customer[]>(() => {
    return telecomRows.map((t) => ({
      id: `telecom:${t.id}`,
      name: t.nome,
      phone_whatsapp: (t.numero || "").replace(/\D/g, ""),
      address_city: t.cidade,
      address_state: t.uf,
      registered_by_name: t.licenciado,
      status: "approved",
      tipo_produto: "telefonia",
      created_at: t.synced_at,
      observacao: t.status_label || null,
    }));
  }, [telecomRows]);

  const segurosAsCustomers = useMemo<Customer[]>(() => {
    return segurosRows.map((s) => ({
      id: `seguro:${s.id}`,
      name: s.segurado,
      phone_whatsapp: "",
      address_city: s.cidade,
      address_state: s.uf,
      registered_by_name: s.licenciado,
      status: "approved",
      tipo_produto: "seguros",
      created_at: s.synced_at,
      observacao: [s.modelo, s.placa].filter(Boolean).join(" · ") || s.status_label || null,
    }));
  }, [segurosRows]);

  const myCustomers = useMemo(() => {
    const normalize = (p: string) => (p || "").replace(/\D/g, "");
    if (selectedTipo === "telefonia") {
      // Enriquece telecom com dados do cliente energia (nome/foto/status) quando bate telefone.
      // Telefone vazio NUNCA pode servir de chave (colidiria todos os sem-número).
      const byPhone = new Map(
        energiaBase
          .map((c) => [normalize(c.phone_whatsapp), c] as const)
          .filter(([p]) => p.length >= 10),
      );
      return telecomAsCustomers.map((t) => {
        const key = normalize(t.phone_whatsapp);
        const match = key.length >= 10 ? byPhone.get(key) : undefined;
        return match ? { ...match, id: t.id, tipo_produto: "telefonia", observacao: t.observacao } : t;
      });
    }
    if (selectedTipo === "seguros") return segurosAsCustomers;
    if (selectedTipo === "all") {
      const phones = new Set(
        energiaBase.map((c) => normalize(c.phone_whatsapp)).filter((p) => p.length >= 10),
      );
      const telecomNew = telecomAsCustomers.filter((t) => {
        const key = normalize(t.phone_whatsapp);
        return key.length < 10 || !phones.has(key);
      });
      return [...energiaBase, ...telecomNew, ...segurosAsCustomers];
    }
    return energiaBase;
  }, [energiaBase, telecomAsCustomers, segurosAsCustomers, selectedTipo]);


  const dealsByCustomer = useCustomerDeals(consultantId, myCustomers);


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
    const requestedAt = new Date().toISOString();
    try {
      // Refetch imediato do que já está no banco (não espera o worker).
      await refreshIgreenQueries();

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
      const syncedAt = new Date().toISOString();
      setLastSync(syncedAt);
      toast({
        title: "Sincronizando todas as contas",
        description: "Lista completa de clientes de cada login iGreen (parceiros inclusive).",
      });
      await refreshIgreenQueries();
      // Worker às vezes finaliza segundos depois da resposta HTTP. Aguarda o
      // run terminar e refaz o fetch pra não deixar o consultor com a lista antiga.
      syncAbortRef.current?.abort();
      const ac = new AbortController();
      syncAbortRef.current = ac;
      void (async () => {
        const finished = await waitIgreenSyncFinished(consultantId, {
          minStartedAt: requestedAt,
          timeoutMs: 300_000,
          signal: ac.signal,
        });
        if (ac.signal.aborted) return;
        await refreshIgreenQueries();
        if (ac.signal.aborted) return;
        if (finished) {
          const extras = (finished.counts?.extras ?? {}) as Record<string, any>;
          const telecom = extras.telecom?.telecom_received ?? extras.telecom?.telecom_saved;
          const seguros = extras.seguros?.seguros_received ?? extras.seguros?.seguros_saved;
          toast({
            title: "Sincronização concluída",
            description: `Clientes, rede e produtos atualizados. Telecom: ${telecom ?? "—"} · Seguros: ${seguros ?? "—"}.`,
          });
        }
      })();

    } catch (err) {
      toast({ title: "Erro na sincronização", description: err instanceof Error ? err.message : "Erro", variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  }

  const { data: networkLicenciados = [] } = useNetworkLicenciados(consultantId);
  const licenciadoOptions = useMemo(() => {
    const names = new Set<string>();
    for (const c of myCustomers) {
      if (c.registered_by_name) names.add(c.registered_by_name);
    }
    // União com licenciados da rede sincronizada (network_members), pra o
    // dropdown mostrar TODOS mesmo os que ainda não têm cliente no CRM local.
    for (const l of networkLicenciados) {
      if (l.name) names.add(l.name);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [myCustomers, networkLicenciados]);

  const distribuidoraOptions = useMemo(() => {
    const names = new Set<string>();
    for (const c of myCustomers) {
      if (c.distribuidora) names.add(c.distribuidora);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [myCustomers]);

  const cidadeOptions = useMemo(() => {
    const names = new Set<string>();
    for (const c of myCustomers) {
      const label = [c.address_city, c.address_state].filter(Boolean).join(" - ");
      if (label) names.add(label);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [myCustomers]);

  const searchFiltered = search.trim()
    ? myCustomers.filter(
        (c) =>
          (c.name || "").toLowerCase().includes(search.toLowerCase()) ||
          c.phone_whatsapp.includes(search) ||
          (c.email || "").toLowerCase().includes(search.toLowerCase()) ||
          (c.cpf || "").includes(search)
      )
    : myCustomers;

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
    if (id.startsWith("telecom:") || id.startsWith("seguro:")) {
      toast({ title: "Não é possível remover", description: "Clientes de Telecom/Seguro vêm da sincronização iGreen.", variant: "destructive" });
      return;
    }
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
    { key: "all", label: "Todos", count: myCustomers.length, color: "text-foreground" },
    { key: "approved", label: "Aprovados", count: myCustomers.filter((c) => c.status === "approved").length, color: "text-primary" },
    { key: "awaiting_signature", label: "Falta Assinatura", count: myCustomers.filter((c) => c.status === "awaiting_signature").length, color: "text-warning" },
    { key: "pending", label: "Pendentes", count: myCustomers.filter((c) => c.status === "pending").length, color: "text-warning" },
    { key: "devolutiva", label: "Devolutiva", count: myCustomers.filter((c) => c.status === "devolutiva" || isDevolutiva(c)).length, color: "text-destructive" },
    { key: "rejected", label: "Reprovados", count: myCustomers.filter((c) => c.status === "rejected").length, color: "text-destructive" },
    { key: "lead", label: "Clientes interessados", count: myCustomers.filter((c) => c.status === "lead").length, color: "text-info" },
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
                Meus clientes
                <span className="ml-2 text-sm font-normal text-muted-foreground">({myCustomers.length})</span>
              </h3>
              <p className="text-[11px] text-muted-foreground truncate">
                Cadastrados por você
                {myClientsSettings?.myIgreenId ? ` (iGreen ${myClientsSettings.myIgreenId})` : ""}
                {lastSync && <span className="hidden sm:inline ml-2 text-muted-foreground/60">• Última sync: {new Date(lastSync).toLocaleString("pt-BR")}</span>}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button onClick={() => setShowAddDialog(true)} size="sm" className="gap-1.5 rounded-xl font-semibold shadow-lg shadow-primary/15 h-9 px-3.5 text-sm" data-tour="base-novo">
              <UserPlus className="w-4 h-4" /> <span>Novo</span><span className="hidden sm:inline">&nbsp;cliente</span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-9 w-9 p-0 rounded-xl" aria-label="Mais ações">
                  <MoreVertical className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem onSelect={(e) => { e.preventDefault(); if (!syncing && syncCooldown === 0) handleSyncIgreen(); }} disabled={syncing || syncCooldown > 0} data-tour="base-sync-igreen">
                  {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  {syncing ? "Sincronizando..." : syncCooldown > 0 ? `Aguarde ${syncCooldown}s` : "Sincronizar iGreen"}
                </DropdownMenuItem>
                <CustomerImportExport
                  asMenuItems
                  customers={myCustomers}
                  filtered={filtered}
                  consultantId={consultantId}
                  onCustomersChange={onCustomersChange}
                />
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Barra de status da última sync iGreen — quantos vieram por produto */}
        <div className="px-4 sm:px-5 pt-3">
          <IGreenSyncStatusBar consultantId={consultantId} />
        </div>

        {/* Search & Filters — barra única consolidada */}
        <div className="px-4 sm:px-5 pt-3 sm:pt-4 pb-3 sm:pb-4 space-y-2.5">
          {/* Search bar */}
          <div className="relative" data-tour="base-busca">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
            <Input
              placeholder="Buscar nome, telefone, CPF, e-mail..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 h-10 sm:h-11 rounded-xl bg-secondary/30 border-border/50 focus:border-primary/40 text-sm"
            />
          </div>

          {/* Linha única de 5 filtros */}
          <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5" data-tour="base-filtros">
            <Combobox
              options={[
                { value: "all", label: "📊 Todos os produtos" },
                { value: "energia", label: "⚡ Energia" },
                { value: "telefonia", label: "📱 Telecom" },
                { value: "solar", label: "☀️ Conexão Solar" },
                { value: "placas", label: "🔋 Conexão Placas" },
                { value: "seguros", label: "🛡️ Seguro" },
              ]}
              value={selectedTipo}
              onChange={(v) => setSelectedTipo((v as typeof selectedTipo) ?? "all")}
              placeholder="Produto"
              searchPlaceholder="Buscar produto…"
              className="h-9 rounded-xl bg-secondary/30 border-border/50 text-xs"
            />

            <Combobox
              options={filterButtons.map((f) => ({
                value: f.key,
                label: f.label,
                hint: String(f.count),
              }))}
              value={statusFilter}
              onChange={(v) => setStatusFilter((v as StatusFilter) ?? "all")}
              placeholder="Status"
              searchPlaceholder="Buscar status…"
              className="h-9 rounded-xl bg-secondary/30 border-border/50 text-xs"
            />

            <Select value={selectedLicenciado} onValueChange={setSelectedLicenciado}>
              <SelectTrigger className="h-9 rounded-xl bg-secondary/30 border-border/50 text-xs">
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
              <SelectTrigger className="h-9 rounded-xl bg-secondary/30 border-border/50 text-xs">
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
              <SelectTrigger className="h-9 rounded-xl bg-secondary/30 border-border/50 text-xs col-span-2 sm:col-span-1">
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

          {/* Limpar filtros — só aparece quando há filtro ativo */}
          {(search || statusFilter !== "all" || selectedTipo !== "all" || selectedLicenciado !== "all" || selectedDistribuidora !== "all" || selectedCidade !== "all") && (
            <div className="flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setSearch("");
                  setStatusFilter("all");
                  setSelectedTipo("all");
                  setSelectedLicenciado("all");
                  setSelectedDistribuidora("all");
                  setSelectedCidade("all");
                }}
              >
                Limpar filtros
              </Button>
            </div>
          )}
        </div>


        {/* List with pagination */}
        <div className="px-4 sm:px-5 pb-5" data-tour="base-lista">
          <PaginatedList
            items={filtered}
            pageSize={20}
            flow
            renderEmpty={() => {
              const isTelecom = selectedTipo === "telefonia";
              const isSeguros = selectedTipo === "seguros";
              const showResyncCta = (isTelecom || isSeguros) && myCustomers.length === 0 && !syncing;
              const productLabel = isTelecom ? "Telecom" : "Seguros";
              const syncMode = isTelecom ? "sync_telecom" : "sync_seguros";
              return (
                <div className="text-center py-16">
                  <div className="w-16 h-16 rounded-2xl bg-secondary/50 flex items-center justify-center mx-auto mb-3">
                    <Users className="w-7 h-7 text-muted-foreground/30" />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {showResyncCta
                      ? `O portal iGreen não devolveu clientes de ${productLabel} para você.`
                      : myCustomers.length === 0
                      ? "Nenhum cliente cadastrado por você"
                      : "Nenhum resultado"}
                  </p>
                  {showResyncCta && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-3 h-8 text-xs"
                      onClick={async () => {
                        setSyncing(true);
                        const requestedAt = new Date().toISOString();
                        try {
                          const res = await runIgreenSync(consultantId, syncMode as "sync_telecom" | "sync_seguros");
                          if (res.ok === false) {
                            toast({ title: `Falha ao buscar ${productLabel}`, description: res.error, variant: "destructive" });
                          } else {
                            toast({ title: `Buscando ${productLabel} novamente…` });
                            const finished = await waitIgreenSyncFinished(consultantId, { timeoutMs: 90_000, minStartedAt: requestedAt });
                            await refreshIgreenQueries();
                            const productCounts = (finished?.counts?.[isTelecom ? "telecom" : "seguros"] ?? {}) as Record<string, unknown>;
                            const received = productCounts[isTelecom ? "telecom_received" : "seguros_received"];
                            if (received != null) toast({ title: `${productLabel} atualizado`, description: `Portal retornou ${received} registro(s).` });
                          }
                        } finally { setSyncing(false); }
                      }}
                    >
                      <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Buscar {productLabel} de novo
                    </Button>
                  )}
                </div>
              );
            }}
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

      <Dialog open={notConfigured} onOpenChange={(o) => !o && setNotConfigured(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-primary" /> Conecte seu Escritório iGreen
            </DialogTitle>
            <DialogDescription className="pt-2">
              Para sincronizar seus clientes e rede, informe o e-mail e a senha do
              escritório iGreen na aba <b>Dados</b>. Depois a sincronização é automática.
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
