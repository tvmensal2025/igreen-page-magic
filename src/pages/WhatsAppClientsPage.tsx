import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Search, Phone, Mail, MapPin, FileText, Calendar, Download, Users, CheckCircle, AlertTriangle, Clock, ChevronDown, ChevronUp, MessageCircle, Briefcase, BadgeDollarSign, TrendingUp } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import PosVendaKanban from "@/components/whatsapp/PosVendaKanban";
import { CarteiraGreenPanel } from "@/features/produtos/carteira-green/CarteiraGreenPanel";

const COMMISSION_RATES = [10, 20, 40, 50, 60, 70, 80, 100] as const;
type CommissionRate = typeof COMMISSION_RATES[number];
const RECURRING_RATE = 0.04;

interface Customer {
  id: string;
  name: string | null;
  cpf: string | null;
  rg: string | null;
  email: string | null;
  phone_whatsapp: string;
  phone_landline: string | null;
  data_nascimento: string | null;
  address_street: string | null;
  address_number: string | null;
  address_complement: string | null;
  address_neighborhood: string | null;
  address_city: string | null;
  address_state: string | null;
  cep: string | null;
  distribuidora: string | null;
  numero_instalacao: string | null;
  electricity_bill_value: number | null;
  conversation_step: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  customer_origin: "igreen_sync" | "whatsapp_lead" | "manual" | null;
  igreen_code?: string | null;
  andamento_igreen?: string | null;
  devolutiva?: string | null;
  // Conversão / comissão
  is_converted?: boolean;
  converted_at?: string | null;
  commission_rate?: CommissionRate | null;
  source_campaign_id?: string | null;
}

type OriginTab = "whatsapp_lead" | "igreen_sync";


const statusConfig: Record<string, { label: string; color: string; bg: string; border: string }> = {
  pending: { label: "Pendente", color: "text-warning", bg: "bg-warning/10", border: "border-warning/20" },
  portal_submitting: { label: "Enviando", color: "text-info", bg: "bg-info/10", border: "border-info/20" },
  awaiting_otp: { label: "Aguardando OTP", color: "text-primary", bg: "bg-primary/10", border: "border-primary/20" },
  validating_otp: { label: "Validando OTP", color: "text-primary", bg: "bg-primary/10", border: "border-primary/20" },
  awaiting_signature: { label: "Aguardando Assinatura", color: "text-warning", bg: "bg-warning/10", border: "border-warning/20" },
  complete: { label: "Completo", color: "text-primary", bg: "bg-primary/10", border: "border-primary/20" },
  approved: { label: "Aprovado", color: "text-primary", bg: "bg-primary/10", border: "border-primary/20" },
  registered_igreen: { label: "Cadastrado iGreen", color: "text-primary", bg: "bg-primary/10", border: "border-primary/20" },
  worker_offline: { label: "Worker Offline", color: "text-destructive", bg: "bg-destructive/10", border: "border-destructive/20" },
  automation_failed: { label: "Falha", color: "text-destructive", bg: "bg-destructive/10", border: "border-destructive/20" },
  lead: { label: "Cliente interessado", color: "text-info", bg: "bg-info/10", border: "border-info/20" },
  data_complete: { label: "Dados Completos", color: "text-primary", bg: "bg-primary/10", border: "border-primary/20" },
  devolutiva: { label: "Devolutiva", color: "text-destructive", bg: "bg-destructive/10", border: "border-destructive/20" },
  rejected: { label: "Reprovado", color: "text-destructive", bg: "bg-destructive/10", border: "border-destructive/20" },
};

const stepLabels: Record<string, string> = {
  welcome: "Boas-vindas", aguardando_conta: "Aguardando Conta",
  processando_ocr_conta: "OCR Conta", confirmando_dados_conta: "Confirmando Dados",
  ask_tipo_documento: "Tipo Doc", aguardando_doc_frente: "Doc Frente",
  aguardando_doc_verso: "Doc Verso", confirmando_dados_doc: "Confirmando Doc",
  ask_name: "Nome", ask_cpf: "CPF", ask_rg: "RG", ask_birth_date: "Data Nasc",
  ask_phone_confirm: "Conf. Telefone", ask_phone: "Telefone", ask_email: "Email",
  ask_cep: "CEP", ask_number: "Número", ask_complement: "Complemento",
  ask_installation_number: "Nº Instalação", ask_bill_value: "Valor Conta",
  ask_finalizar: "Finalizar", finalizando: "Finalizando",
  portal_submitting: "Enviando Portal", aguardando_otp: "Aguardando OTP",
  validando_otp: "Validando OTP", aguardando_assinatura: "Aguardando Assinatura",
  complete: "Completo",
};

export default function WhatsAppClientsPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [originTab, setOriginTab] = useState<OriginTab>("whatsapp_lead");
  const [convertingId, setConvertingId] = useState<string | null>(null);
  const [consultantId, setConsultantId] = useState<string | null>(null);

  useEffect(() => { loadCustomers(); }, []);

  const loadCustomers = async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { toast.error("Usuário não autenticado"); return; }
      const { data: consultant } = await supabase.from("consultants").select("id").eq("id", user.id).single();
      if (!consultant) { toast.error("Consultor não encontrado"); return; }
      setConsultantId(consultant.id);
      const { data, error } = await supabase.from("customers").select("*").eq("consultant_id", consultant.id).order("created_at", { ascending: false });
      if (error) throw error;
      setCustomers((data as any) || []);
    } catch (error: any) {
      console.error("Erro ao carregar clientes:", error);
      toast.error("Erro ao carregar clientes");
    } finally {
      setLoading(false);
    }
  };

  // ─── Marcar/desmarcar conversão ──────────────────────────────────────
  async function toggleConverted(c: Customer) {
    setConvertingId(c.id);
    const nowConverted = !c.is_converted;
    const patch: any = {
      is_converted: nowConverted,
      converted_at: nowConverted ? new Date().toISOString() : null,
    };
    const { error } = await supabase.from("customers").update(patch).eq("id", c.id);
    if (error) {
      toast.error("Erro ao atualizar: " + error.message);
    } else {
      setCustomers((prev) => prev.map((x) => x.id === c.id ? { ...x, ...patch } : x));
      toast.success(nowConverted ? "✅ Cliente interessado marcado como convertido!" : "Cliente interessado desmarcado");
    }
    setConvertingId(null);
  }

  async function saveCommissionRate(customerId: string, rate: CommissionRate | null) {
    const { error } = await supabase
      .from("customers")
      .update({ commission_rate: rate } as any)
      .eq("id", customerId);
    if (error) {
      toast.error("Erro ao salvar %: " + error.message);
    } else {
      setCustomers((prev) => prev.map((x) => x.id === customerId ? { ...x, commission_rate: rate } : x));
      toast.success(rate ? `${rate}% salvo para este lead` : "% removido");
    }
  }

  const leadsWhatsapp = useMemo(
    () => customers.filter((c) => (c.customer_origin || "whatsapp_lead") === "whatsapp_lead" || c.customer_origin === "manual"),
    [customers],
  );
  const clientesIgreen = useMemo(
    () => customers.filter((c) => c.customer_origin === "igreen_sync"),
    [customers],
  );

  const activeList = originTab === "whatsapp_lead" ? leadsWhatsapp : clientesIgreen;

  // Reset status filter when switching tab (statuses differ)
  useEffect(() => { setFilterStatus("all"); }, [originTab]);

  const filteredCustomers = activeList.filter((c) => {
    const matchesSearch = !searchTerm ||
      c.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.cpf?.includes(searchTerm) ||
      c.phone_whatsapp?.includes(searchTerm) ||
      c.email?.toLowerCase().includes(searchTerm.toLowerCase());
    if (!matchesSearch) return false;
    if (filterStatus === "all") return true;
    if (originTab === "igreen_sync") {
      // For iGreen, status filter applies to status OR andamento_igreen text
      if (filterStatus === "devolutiva") return !!c.devolutiva || /devolutiva/i.test(c.andamento_igreen || "");
      return c.status === filterStatus;
    }
    return c.status === filterStatus;

  });

  const exportToCSV = () => {
    const headers = [
      "Nome","CPF","RG","Email","Telefone","Data Nascimento",
      "Rua","Número","Complemento","Bairro","Cidade","Estado","CEP",
      "Distribuidora","Nº Instalação","Consumo Médio (kW)","Valor Conta (R$)","Desconto Cliente (%)",
      "Tipo Produto","Código iGreen","Andamento","Devolutiva","Status Financeiro",
      "Cashback","Nível Licenciado","Licenciado","Código Licenciado",
      "Indicado Por","Telefone Indicador",
      "Assinatura Cliente","Assinatura iGreen","Link Assinatura",
      "Data Cadastro","Data Ativo","Data Validado",
      "Status","Step","Observação",
    ];
    const rows = filteredCustomers.map((c: any) => [
      c.name||"",c.cpf||"",c.rg||"",c.email||"",c.phone_whatsapp||"",c.data_nascimento||"",
      c.address_street||"",c.address_number||"",c.address_complement||"",
      c.address_neighborhood||"",c.address_city||"",c.address_state||"",c.cep||"",
      c.distribuidora||"",c.numero_instalacao||"",
      c.media_consumo??"",c.electricity_bill_value??"",c.desconto_cliente??"",
      c.tipo_produto||"energia",c.igreen_code||"",c.andamento_igreen||"",
      c.devolutiva||"",c.status_financeiro||"",
      c.cashback||"",c.nivel_licenciado||"",
      c.registered_by_name||"",c.registered_by_igreen_id||"",
      c.customer_referred_by_name||"",c.customer_referred_by_phone||"",
      c.assinatura_cliente||"",c.assinatura_igreen||"",c.link_assinatura||"",
      c.data_cadastro||(c.created_at?format(new Date(c.created_at),"dd/MM/yyyy HH:mm",{locale:ptBR}):""),
      c.data_ativo||"",c.data_validado||"",
      c.status||"",stepLabels[c.conversation_step||""]||c.conversation_step||"",c.observacao||"",
    ]);
    const csv = [headers,...rows].map(r => r.map(cell => `"${cell}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8;"});
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `clientes-whatsapp-${format(new Date(),"yyyy-MM-dd")}.csv`;
    link.click();
    toast.success("Exportado com sucesso!");
  };

  const isLeadsTab = originTab === "whatsapp_lead";

  // Mini-resumo de comissão para os leads WhatsApp convertidos
  const convertedLeads = leadsWhatsapp.filter((c) => c.is_converted);
  const totalBillConverted = convertedLeads.reduce((s, c) => s + Number(c.electricity_bill_value || 0), 0);
  const totalFirstSale = convertedLeads.reduce((s, c) => {
    const rate = (c.commission_rate ?? 0) / 100;
    return s + Number(c.electricity_bill_value || 0) * rate;
  }, 0);
  const totalRecurring = totalBillConverted * RECURRING_RATE;

  const stats = isLeadsTab
    ? [
        { label: "Total clientes interessados", value: leadsWhatsapp.length, icon: Users, gradient: "from-primary/10 to-primary/5", iconColor: "text-primary" },
        { label: "Em conversa", value: leadsWhatsapp.filter(c => c.status === "pending" && c.conversation_step && c.conversation_step !== "welcome").length, icon: MessageCircle, gradient: "from-info/10 to-info/5", iconColor: "text-info" },
        { label: "Convertidos", value: convertedLeads.length, icon: BadgeDollarSign, gradient: "from-primary/10 to-primary/5", iconColor: "text-primary" },
        { label: "Falhas / Pausados", value: leadsWhatsapp.filter(c => c.status === "automation_failed" || c.status === "worker_offline").length, icon: AlertTriangle, gradient: "from-destructive/10 to-destructive/5", iconColor: "text-destructive" },
      ]
    : [
        { label: "Total carteira", value: clientesIgreen.length, icon: Briefcase, gradient: "from-primary/10 to-primary/5", iconColor: "text-primary" },
        { label: "Ativos", value: clientesIgreen.filter(c => /ativo/i.test(c.andamento_igreen || "") || c.status === "active").length, icon: CheckCircle, gradient: "from-primary/10 to-primary/5", iconColor: "text-primary" },
        { label: "Devolutiva", value: clientesIgreen.filter(c => !!c.devolutiva || /devolutiva/i.test(c.andamento_igreen || "")).length, icon: AlertTriangle, gradient: "from-destructive/10 to-destructive/5", iconColor: "text-destructive" },
        { label: "Em análise / Outros", value: clientesIgreen.filter(c => !c.devolutiva && !/ativo|devolutiva/i.test(c.andamento_igreen || "")).length, icon: Clock, gradient: "from-warning/10 to-warning/5", iconColor: "text-warning" },
      ];

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center animate-pulse">
          <Loader2 className="w-7 h-7 animate-spin text-primary" />
        </div>
        <p className="text-sm text-muted-foreground">Carregando clientes...</p>
      </div>
    );
  }

  return (
    <div className="max-w-[1760px] mx-auto px-4 sm:px-6 lg:px-8 xl:px-12 py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold font-heading text-foreground">
            {isLeadsTab ? "Clientes interessados WhatsApp" : "Clientes iGreen"}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {isLeadsTab
              ? "Pessoas que chegaram pelo anúncio e estão em conversa no WhatsApp"
              : "Clientes já cadastrados, sincronizados do portal iGreen (ativos, devolutivas, em análise...)"}
          </p>
        </div>
        <Button onClick={exportToCSV} variant="outline" className="gap-2 rounded-xl border-border/50 hover:border-primary/30">
          <Download className="w-4 h-4" />
          Exportar CSV
        </Button>
      </div>

      {/* Origin tabs — Leads NUNCA misturam com Clientes iGreen */}
      <Tabs value={originTab} onValueChange={(v) => setOriginTab(v as OriginTab)}>
        <TabsList className="grid grid-cols-2 w-full sm:w-auto sm:inline-grid h-11 rounded-xl">
          <TabsTrigger value="whatsapp_lead" className="gap-2 rounded-lg">
            <MessageCircle className="w-4 h-4" />
            Clientes interessados WhatsApp
            <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">{leadsWhatsapp.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="igreen_sync" className="gap-2 rounded-lg">
            <Briefcase className="w-4 h-4" />
            Clientes iGreen
            <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">{clientesIgreen.length}</Badge>
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* CRM Pós-Venda (Clientes iGreen) */}
      {!isLeadsTab && consultantId && (
        <div className="premium-card !p-4 bg-gradient-to-br from-background to-muted/20">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold font-heading text-foreground flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-primary" />
                CRM Pós-Venda
              </h2>
              <p className="text-xs text-muted-foreground">
                Acompanhamento automático: Aprovado, Reprovado e ciclo de 30 a 120 dias.
              </p>
            </div>
          </div>
          <PosVendaKanban consultantId={consultantId} />
        </div>
      )}


      {/* Stats (Leads WhatsApp) */}
      {isLeadsTab && (
      <>
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {stats.map((s) => (
          <div key={s.label} className="premium-card !p-4">
            <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${s.gradient} flex items-center justify-center mb-3`}>
              <s.icon className={`w-4 h-4 ${s.iconColor}`} />
            </div>
            <p className="text-2xl font-bold text-foreground tracking-tight">{s.value}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5 font-medium">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="premium-card !p-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome, CPF, telefone ou email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 h-10 bg-muted/30 border-border/50 rounded-xl"
            />
          </div>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-full sm:w-[220px] h-10 rounded-xl border-border/50 bg-muted/30">
              <SelectValue placeholder="Todos os Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os Status</SelectItem>
              {isLeadsTab ? (
                <>
                  <SelectItem value="pending">Pendente</SelectItem>
                  <SelectItem value="approved">Aprovado</SelectItem>
                  <SelectItem value="awaiting_signature">Aguardando Assinatura</SelectItem>
                  <SelectItem value="complete">Completo</SelectItem>
                  <SelectItem value="registered_igreen">Cadastrado iGreen</SelectItem>
                  <SelectItem value="automation_failed">Falha</SelectItem>
                </>
              ) : (
                <>
                  <SelectItem value="active">Ativo</SelectItem>
                  <SelectItem value="inactive">Inativo</SelectItem>
                  <SelectItem value="devolutiva">Com devolutiva</SelectItem>
                  <SelectItem value="pending">Em análise</SelectItem>
                  <SelectItem value="rejected">Reprovado</SelectItem>
                </>
              )}
            </SelectContent>
          </Select>
          <Badge variant="outline" className="self-center text-xs py-2 px-3 border-border/50 whitespace-nowrap">
            {filteredCustomers.length} resultado(s)
          </Badge>
        </div>
      </div>


      {/* Banner de comissão acumulada — só aparece quando há convertidos */}
      {isLeadsTab && convertedLeads.length > 0 && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
          <div className="flex items-center gap-2 mb-3">
            <BadgeDollarSign className="w-4 h-4 text-primary" />
            <span className="font-semibold text-foreground text-sm">Resumo de Comissões — {convertedLeads.length} lead{convertedLeads.length !== 1 ? "s" : ""} convertido{convertedLeads.length !== 1 ? "s" : ""}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
            <div className="rounded-lg bg-background/60 border border-border/40 px-3 py-2.5">
              <p className="text-muted-foreground">Soma das faturas</p>
              <p className="font-bold text-foreground text-base">{totalBillConverted.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</p>
            </div>
            <div className="rounded-lg bg-primary/10 border border-primary/20 px-3 py-2.5">
              <p className="text-muted-foreground">Comissão 1ª venda</p>
              <p className="font-bold text-primary text-base">{totalFirstSale.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</p>
              <p className="text-muted-foreground/70 text-[10px]">% configurado × fatura</p>
            </div>
            <div className="rounded-lg bg-warning/10 border border-warning/20 px-3 py-2.5">
              <p className="text-muted-foreground">Recorrente/mês (4%)</p>
              <p className="font-bold text-warning text-base">{totalRecurring.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</p>
              <p className="text-muted-foreground/70 text-[10px]">todo mês enquanto ativo</p>
            </div>
          </div>
        </div>
      )}

      {/* Customer List */}
      <div className="space-y-2">
        {filteredCustomers.length === 0 ? (
          <div className="premium-card text-center py-16">
            <Search className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-muted-foreground font-medium">Nenhum cliente encontrado</p>
          </div>
        ) : (
          filteredCustomers.map((c) => {
            const sc = statusConfig[c.status] || { label: c.status, color: "text-muted-foreground", bg: "bg-muted", border: "border-border" };
            const isExpanded = expandedId === c.id;

            return (
              <div key={c.id} className="premium-card !p-0 overflow-hidden">
                <button
                  className="w-full p-4 flex items-center gap-4 text-left hover:bg-muted/20 transition-colors"
                  onClick={() => setExpandedId(isExpanded ? null : c.id)}
                >
                  {/* Avatar */}
                  <div className={`w-10 h-10 rounded-xl ${sc.bg} flex items-center justify-center shrink-0`}>
                    <span className={`text-sm font-bold ${sc.color}`}>
                      {(c.name || "?").charAt(0).toUpperCase()}
                    </span>
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <span className="font-semibold text-foreground truncate">{c.name || "Nome não informado"}</span>
                      <Badge className={`text-[10px] px-2 py-0 h-5 border ${sc.bg} ${sc.color} ${sc.border}`}>{sc.label}</Badge>
                      {c.conversation_step && c.conversation_step !== "complete" && (
                        <Badge variant="outline" className="text-[10px] px-2 py-0 h-5 border-border/50">
                          {stepLabels[c.conversation_step] || c.conversation_step}
                        </Badge>
                      )}
                      {c.is_converted && (
                        <Badge className="text-[10px] px-2 py-0 h-5 bg-primary/15 text-primary border border-primary/30">
                          ✓ Convertido
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      {c.phone_whatsapp && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{c.phone_whatsapp}</span>}
                      {c.address_city && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{c.address_city}/{c.address_state}</span>}
                      <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{format(new Date(c.created_at), "dd/MM/yy", { locale: ptBR })}</span>
                    </div>
                  </div>

                  {/* Expand icon */}
                  <div className="shrink-0 text-muted-foreground">
                    {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </div>
                </button>

                {/* Expanded details */}
                {isExpanded && (
                  <div className="px-4 pb-4 pt-0 border-t border-border/30">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-4 text-sm">
                      {c.cpf && <InfoField icon={<FileText />} label="CPF" value={c.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4")} />}
                      {c.rg && <InfoField icon={<FileText />} label="RG" value={c.rg} />}
                      {c.email && <InfoField icon={<Mail />} label="Email" value={c.email} />}
                      {c.data_nascimento && <InfoField icon={<Calendar />} label="Nascimento" value={c.data_nascimento} />}
                      {c.distribuidora && <InfoField icon={<FileText />} label="Distribuidora" value={c.distribuidora} />}
                      {c.numero_instalacao && <InfoField icon={<FileText />} label="Nº Instalação" value={c.numero_instalacao} />}
                      {c.electricity_bill_value && <InfoField icon={<FileText />} label="Valor Conta" value={`R$ ${c.electricity_bill_value.toFixed(2)}`} />}
                    </div>
                    {c.address_street && (
                      <div className="mt-3 pt-3 border-t border-border/20">
                        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                          <MapPin className="w-3.5 h-3.5 shrink-0" />
                          {c.address_street}, {c.address_number}
                          {c.address_complement && ` - ${c.address_complement}`}
                          {c.address_neighborhood && ` - ${c.address_neighborhood}`}
                          {c.cep && ` - CEP: ${c.cep.replace(/(\d{5})(\d{3})/, "$1-$2")}`}
                        </p>
                      </div>
                    )}

                    {/* ─── Bloco de Conversão / Comissão ─── */}
                    {isLeadsTab && (
                      <div className="mt-3 pt-3 border-t border-border/20">
                        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                          {/* Botão converter */}
                          <Button
                            size="sm"
                            variant={c.is_converted ? "outline" : "default"}
                            className={`gap-1.5 h-8 text-xs ${c.is_converted ? "border-primary/40 text-primary hover:bg-primary/10" : ""}`}
                            onClick={(e) => { e.stopPropagation(); toggleConverted(c); }}
                            disabled={convertingId === c.id}
                          >
                            {convertingId === c.id
                              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              : c.is_converted
                              ? <><CheckCircle className="w-3.5 h-3.5" /> Convertido — desfazer</>
                              : <><BadgeDollarSign className="w-3.5 h-3.5" /> Marcar como convertido</>}
                          </Button>

                          {/* Seletor de % de comissão */}
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground whitespace-nowrap">% comissão:</span>
                            <Select
                              value={c.commission_rate ? String(c.commission_rate) : "none"}
                              onValueChange={(v) => saveCommissionRate(c.id, v === "none" ? null : Number(v) as CommissionRate)}
                            >
                              <SelectTrigger className="w-24 h-8 text-xs" onClick={(e) => e.stopPropagation()}>
                                <SelectValue placeholder="Definir" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">Não definido</SelectItem>
                                {COMMISSION_RATES.map((r) => (
                                  <SelectItem key={r} value={String(r)}>{r}%</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          {/* Preview do valor de comissão */}
                          {c.is_converted && c.electricity_bill_value && c.commission_rate && (
                            <div className="flex items-center gap-3 text-xs flex-wrap">
                              <span className="rounded-lg bg-primary/10 border border-primary/20 px-2.5 py-1.5">
                                <span className="text-muted-foreground">1ª venda: </span>
                                <span className="font-bold text-primary">
                                  {(c.electricity_bill_value * c.commission_rate / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                                </span>
                              </span>
                              <span className="rounded-lg bg-warning/10 border border-warning/20 px-2.5 py-1.5">
                                <span className="text-muted-foreground">Recorrente/mês: </span>
                                <span className="font-bold text-warning">
                                  {(c.electricity_bill_value * RECURRING_RATE).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                                </span>
                              </span>
                            </div>
                          )}

                          {/* Data de conversão */}
                          {c.is_converted && c.converted_at && (
                            <span className="text-[10px] text-muted-foreground ml-auto">
                              Convertido em {format(new Date(c.converted_at), "dd/MM/yy HH:mm", { locale: ptBR })}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
      </>
      )}
    </div>
  );
}

function InfoField({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl bg-muted/30 px-3 py-2.5">
      <span className="w-4 h-4 text-muted-foreground shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="text-[10px] text-muted-foreground">{label}</p>
        <p className="text-sm font-medium text-foreground truncate">{value}</p>
      </div>
    </div>
  );
}
