import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  Search,
  Phone,
  Mail,
  MapPin,
  FileText,
  Calendar,
  Download,
  Briefcase,
  CheckCircle,
  AlertTriangle,
  Clock,
  ChevronDown,
  ChevronUp,
  ArrowRight,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CarteiraGreenPanel } from "@/features/produtos/carteira-green/CarteiraGreenPanel";

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
  status: string;
  created_at: string;
  updated_at: string;
  customer_origin: "igreen_sync" | "whatsapp_lead" | "manual" | null;
  igreen_code?: string | null;
  andamento_igreen?: string | null;
  devolutiva?: string | null;
}

export default function WhatsAppClientsPage() {
  const navigate = useNavigate();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [consultantId, setConsultantId] = useState<string | null>(null);

  // Redireciona URLs antigas de "clientes interessados WhatsApp" para o funil de Conversão.
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search).get("tab");
      if (q === "whatsapp" || q === "whatsapp_lead") {
        navigate("/admin?tab=conversao", { replace: true });
      }
    } catch {}
  }, [navigate]);

  useEffect(() => {
    loadCustomers();
  }, []);

  const loadCustomers = async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { toast.error("Usuário não autenticado"); return; }
      const { data: consultant } = await supabase.from("consultants").select("id").eq("id", user.id).single();
      if (!consultant) { toast.error("Consultor não encontrado"); return; }
      setConsultantId(consultant.id);
      const { data, error } = await supabase
        .from("customers")
        .select("*")
        .eq("consultant_id", consultant.id)
        .eq("customer_origin", "igreen_sync")
        .order("created_at", { ascending: false });
      if (error) throw error;
      setCustomers((data as any) || []);
    } catch (error: any) {
      console.error("Erro ao carregar clientes:", error);
      toast.error("Erro ao carregar clientes");
    } finally {
      setLoading(false);
    }
  };

  const filteredCustomers = useMemo(() => customers.filter((c) => {
    const q = searchTerm.trim().toLowerCase();
    const matchesSearch = !q ||
      c.name?.toLowerCase().includes(q) ||
      c.cpf?.includes(searchTerm) ||
      c.phone_whatsapp?.includes(searchTerm) ||
      c.email?.toLowerCase().includes(q);
    if (!matchesSearch) return false;
    if (filterStatus === "all") return true;
    if (filterStatus === "devolutiva") return !!c.devolutiva || /devolutiva/i.test(c.andamento_igreen || "");
    return c.status === filterStatus;
  }), [customers, searchTerm, filterStatus]);

  const stats = useMemo(() => ([
    {
      label: "Total carteira",
      value: customers.length,
      icon: Briefcase,
      iconColor: "text-primary",
      iconBg: "bg-primary/10",
    },
    {
      label: "Ativos",
      value: customers.filter((c) => /ativo/i.test(c.andamento_igreen || "") || c.status === "active").length,
      icon: CheckCircle,
      iconColor: "text-primary",
      iconBg: "bg-primary/10",
    },
    {
      label: "Devolutiva",
      value: customers.filter((c) => !!c.devolutiva || /devolutiva/i.test(c.andamento_igreen || "")).length,
      icon: AlertTriangle,
      iconColor: "text-destructive",
      iconBg: "bg-destructive/10",
    },
    {
      label: "Em análise",
      value: customers.filter((c) => !c.devolutiva && !/ativo|devolutiva/i.test(c.andamento_igreen || "")).length,
      icon: Clock,
      iconColor: "text-warning",
      iconBg: "bg-warning/10",
    },
  ]), [customers]);

  const exportToCSV = () => {
    const headers = [
      "Nome","CPF","RG","Email","Telefone","Data Nascimento",
      "Rua","Número","Complemento","Bairro","Cidade","Estado","CEP",
      "Distribuidora","Nº Instalação","Valor Conta (R$)",
      "Código iGreen","Andamento","Devolutiva",
      "Status","Data Cadastro",
    ];
    const rows = filteredCustomers.map((c: any) => [
      c.name || "", c.cpf || "", c.rg || "", c.email || "", c.phone_whatsapp || "", c.data_nascimento || "",
      c.address_street || "", c.address_number || "", c.address_complement || "",
      c.address_neighborhood || "", c.address_city || "", c.address_state || "", c.cep || "",
      c.distribuidora || "", c.numero_instalacao || "", c.electricity_bill_value ?? "",
      c.igreen_code || "", c.andamento_igreen || "", c.devolutiva || "",
      c.status || "", c.created_at ? format(new Date(c.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR }) : "",
    ]);
    const csv = [headers, ...rows].map((r) => r.map((cell) => `"${cell}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `clientes-igreen-${format(new Date(), "yyyy-MM-dd")}.csv`;
    link.click();
    toast.success("Exportado com sucesso!");
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
        <p className="text-sm text-muted-foreground">Carregando clientes...</p>
      </div>
    );
  }

  return (
    <div className="max-w-[1760px] mx-auto px-4 sm:px-6 lg:px-8 xl:px-12 py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Clientes iGreen</h1>
          <p className="text-sm text-muted-foreground">
            Carteira sincronizada do portal iGreen — ativos, devolutivas e em análise.
          </p>
          <button
            type="button"
            onClick={() => navigate("/admin?tab=conversao")}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mt-1"
          >
            Ver clientes interessados no funil de Conversão
            <ArrowRight className="w-3 h-3" />
          </button>
        </div>
        <Button onClick={exportToCSV} variant="outline" size="sm" className="gap-2">
          <Download className="w-4 h-4" />
          Exportar CSV
        </Button>
      </div>

      {/* Carteira iGreen */}
      {consultantId && (
        <section className="rounded-xl border border-border/60 bg-card p-4 sm:p-5">
          <div className="mb-4 flex items-center gap-2">
            <Briefcase className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-base font-semibold text-foreground">Carteira iGreen</h2>
          </div>
          <CarteiraGreenPanel consultantId={consultantId} />
        </section>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border border-border/60 bg-card p-4">
            <div className={`w-9 h-9 rounded-lg ${s.iconBg} flex items-center justify-center mb-3`}>
              <s.icon className={`w-4 h-4 ${s.iconColor}`} />
            </div>
            <p className="text-2xl font-semibold text-foreground tabular-nums">{s.value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="rounded-xl border border-border/60 bg-card p-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome, CPF, telefone ou email…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 h-10"
            />
          </div>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-full sm:w-[220px] h-10">
              <SelectValue placeholder="Todos os status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os status</SelectItem>
              <SelectItem value="active">Ativo</SelectItem>
              <SelectItem value="inactive">Inativo</SelectItem>
              <SelectItem value="devolutiva">Com devolutiva</SelectItem>
              <SelectItem value="pending">Em análise</SelectItem>
              <SelectItem value="rejected">Reprovado</SelectItem>
            </SelectContent>
          </Select>
          <Badge variant="outline" className="self-center text-xs py-2 px-3 whitespace-nowrap">
            {filteredCustomers.length} resultado(s)
          </Badge>
        </div>
      </div>

      {/* Customer List */}
      <div className="space-y-2">
        {filteredCustomers.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/60 text-center py-16">
            <Search className="w-7 h-7 text-muted-foreground/50 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Nenhum cliente encontrado</p>
          </div>
        ) : (
          filteredCustomers.map((c) => {
            const isExpanded = expandedId === c.id;
            const initial = (c.name || "?").charAt(0).toUpperCase();
            return (
              <div key={c.id} className="rounded-xl border border-border/60 bg-card overflow-hidden">
                <button
                  className="w-full p-4 flex items-center gap-4 text-left hover:bg-muted/40 transition-colors"
                  onClick={() => setExpandedId(isExpanded ? null : c.id)}
                >
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <span className="text-sm font-semibold text-primary">{initial}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <span className="font-medium text-foreground truncate">
                        {c.name || "Nome não informado"}
                      </span>
                      {c.andamento_igreen && (
                        <Badge variant="outline" className="text-[10px] px-2 py-0 h-5">
                          {c.andamento_igreen}
                        </Badge>
                      )}
                      {c.devolutiva && (
                        <Badge className="text-[10px] px-2 py-0 h-5 bg-destructive/10 text-destructive border border-destructive/30">
                          Devolutiva
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                      {c.phone_whatsapp && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{c.phone_whatsapp}</span>}
                      {c.address_city && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{c.address_city}/{c.address_state}</span>}
                      <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{format(new Date(c.created_at), "dd/MM/yy", { locale: ptBR })}</span>
                    </div>
                  </div>
                  <div className="shrink-0 text-muted-foreground">
                    {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </div>
                </button>

                {isExpanded && (
                  <div className="px-4 pb-4 pt-3 border-t border-border/40">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
                      {c.cpf && <InfoField icon={<FileText />} label="CPF" value={c.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4")} />}
                      {c.rg && <InfoField icon={<FileText />} label="RG" value={c.rg} />}
                      {c.email && <InfoField icon={<Mail />} label="Email" value={c.email} />}
                      {c.data_nascimento && <InfoField icon={<Calendar />} label="Nascimento" value={c.data_nascimento} />}
                      {c.distribuidora && <InfoField icon={<FileText />} label="Distribuidora" value={c.distribuidora} />}
                      {c.numero_instalacao && <InfoField icon={<FileText />} label="Nº Instalação" value={c.numero_instalacao} />}
                      {c.electricity_bill_value && <InfoField icon={<FileText />} label="Valor Conta" value={`R$ ${c.electricity_bill_value.toFixed(2)}`} />}
                      {c.igreen_code && <InfoField icon={<FileText />} label="Código iGreen" value={c.igreen_code} />}
                    </div>
                    {c.address_street && (
                      <div className="mt-3 pt-3 border-t border-border/40">
                        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                          <MapPin className="w-3.5 h-3.5 shrink-0" />
                          {c.address_street}, {c.address_number}
                          {c.address_complement && ` - ${c.address_complement}`}
                          {c.address_neighborhood && ` - ${c.address_neighborhood}`}
                          {c.cep && ` - CEP: ${c.cep.replace(/(\d{5})(\d{3})/, "$1-$2")}`}
                        </p>
                      </div>
                    )}
                    {c.devolutiva && (
                      <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                        <strong className="font-medium">Devolutiva:</strong> {c.devolutiva}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function InfoField({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg bg-muted/40 px-3 py-2.5">
      <span className="w-4 h-4 text-muted-foreground shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="text-[11px] text-muted-foreground">{label}</p>
        <p className="text-sm font-medium text-foreground truncate">{value}</p>
      </div>
    </div>
  );
}
