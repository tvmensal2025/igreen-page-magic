import { useState, useMemo, useCallback } from "react";
import { Users, ClipboardPaste, FileSpreadsheet, Download, Search, X, CheckSquare, AlertTriangle, Trash2, Phone, Loader2, UserCircle, Globe, MessageSquare, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/components/ui/use-toast";
import * as XLSX from "xlsx";
import { findContacts, fetchAllGroups, getGroupParticipants, type EvolutionContact, type EvolutionGroup, type EvolutionGroupParticipant } from "@/services/evolutionApi";
import type { BulkContact } from "@/types/whatsapp";

interface Customer {
  id: string; name: string; phone_whatsapp: string; electricity_bill_value?: number;
  status?: string; devolutiva?: string | null; registered_by_name?: string | null;
  last_inbound_at?: string | null;
}

interface ContactImporterProps {
  customers: Customer[];
  contacts: BulkContact[];
  onContactsChange: (contacts: BulkContact[]) => void;
  disabled?: boolean;
  instanceName?: string;
}

function isValidPhone(phone: string): boolean {
  if (!phone) return false;
  if (/sem_celular/i.test(phone)) return false;
  return phone.replace(/\D/g, "").length >= 10;
}

/** Extract DDD (2-digit area code) from a Brazilian phone */
function getDdd(phone: string): string | null {
  if (!phone) return null;
  const d = phone.replace(/\D/g, "");
  if (d.length === 12 || d.length === 13) {
    if (d.startsWith("55")) return d.slice(2, 4);
  }
  if (d.length === 10 || d.length === 11) return d.slice(0, 2);
  return null;
}

const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (/^55\d{10,11}$/.test(digits)) {
    const ddd = digits.slice(2, 4);
    const number = digits.slice(4);
    if (number.length === 9) return `(${ddd}) ${number.slice(0, 5)}-${number.slice(5)}`;
    if (number.length === 8) return `(${ddd}) ${number.slice(0, 4)}-${number.slice(4)}`;
  }
  if (digits.length > 8) return `+${digits.slice(0, 2)} ${digits.slice(2)}`;
  return raw;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return (name[0] || "?").toUpperCase();
}

const AVATAR_COLORS = [
  "bg-blue-500/20 text-blue-400",
  "bg-emerald-500/20 text-emerald-400",
  "bg-purple-500/20 text-purple-400",
  "bg-orange-500/20 text-orange-400",
  "bg-pink-500/20 text-pink-400",
  "bg-cyan-500/20 text-cyan-400",
  "bg-amber-500/20 text-amber-400",
  "bg-rose-500/20 text-rose-400",
];

function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

type StatusFilter = "all" | "approved" | "rejected" | "pending";

const DEVOLUTIVA_CATEGORIES = [
  { key: "fatura_ilegivel", label: "Fatura Ilegível", match: ["fatura ilegível", "fatura ilegivel"] },
  { key: "sem_fatura", label: "Sem Fatura de Energia", match: ["sem anexo de fatura", "fatura de energia não anexada", "fatura não anexada"] },
  { key: "distribuidora_diferente", label: "Distribuidora Diferente", match: ["distribuidora da fatura diferente"] },
  { key: "sem_documento", label: "Sem Documento Pessoal", match: ["sem anexo de documento pessoal"] },
  { key: "documento_ilegivel", label: "Documento Ilegível", match: ["ilegível no anexo de rg", "ilegível no anexo de cnh"] },
  { key: "debito_aberto", label: "Débito em Aberto", match: ["débito em aberto", "débitos em aberto", "debito em aberto"] },
  { key: "fatura_desatualizada", label: "Fatura Desatualizada", match: ["fatura desatualizada"] },
  { key: "cancelado", label: "Cancelado", match: ["cancelado"] },
  { key: "consumo_inferior", label: "Consumo Inferior", match: ["consumo inferior"] },
];

function matchDevolutiva(devolutiva: string | null | undefined, categoryKey: string): boolean {
  if (!devolutiva) return false;
  const lower = devolutiva.toLowerCase();
  const cat = DEVOLUTIVA_CATEGORIES.find(c => c.key === categoryKey);
  if (!cat) return false;
  return cat.match.some(m => lower.includes(m));
}

function statusBadge(status?: string) {
  switch (status) {
    case "approved": return { label: "Aprovado", cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25" };
    case "rejected": return { label: "Reprovado", cls: "bg-red-500/15 text-red-400 border-red-500/25" };
    case "pending": return { label: "Pendente", cls: "bg-amber-500/15 text-amber-400 border-amber-500/25" };
    case "active": return { label: "Ativo", cls: "bg-blue-500/15 text-blue-400 border-blue-500/25" };
    default: return null;
  }
}

function ContactRow({ name, phone, valid, selected, onToggle, status, source }: {
  name: string; phone: string; valid: boolean; selected?: boolean;
  onToggle?: () => void; status?: string; source?: string;
}) {
  const badge = status ? statusBadge(status) : null;
  return (
    <div className={`flex items-center gap-2.5 px-3 py-2 transition-colors ${!valid ? "opacity-40" : ""} ${selected ? "bg-primary/5" : "hover:bg-secondary/40"}`}>
      {onToggle && <Checkbox checked={selected} onCheckedChange={onToggle} disabled={!valid} />}
      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${getAvatarColor(name)}`}>
        {getInitials(name)}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground truncate leading-tight">{name}</p>
        <div className="flex items-center gap-1.5 mt-0.5">
          <Phone className="w-3 h-3 text-muted-foreground/60" />
          <span className={`text-xs ${valid ? "text-muted-foreground" : "text-red-400 line-through"}`}>
            {formatPhone(phone)}
          </span>
        </div>
      </div>
      {badge && (
        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md border shrink-0 ${badge.cls}`}>
          {badge.label}
        </span>
      )}
      {source && (
        <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${
          source === "database" ? "bg-blue-500/15 text-blue-400" :
          source === "pasted" ? "bg-purple-500/15 text-purple-400" :
          source === "group" ? "bg-cyan-500/15 text-cyan-400" :
          source === "contact" ? "bg-orange-500/15 text-orange-400" :
          "bg-green-500/15 text-green-400"
        }`}>
          {source === "database" ? "Base" : source === "pasted" ? "Colado" : source === "group" ? "Grupo" : source === "contact" ? "Celular" : "Importado"}
        </span>
      )}
      {!valid && <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />}
    </div>
  );
}

export function ContactImporter({ customers, contacts, onContactsChange, disabled, instanceName }: ContactImporterProps) {
  const [activeTab, setActiveTab] = useState("database");
  const [pasteText, setPasteText] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [devolutivaFilter, setDevolutivaFilter] = useState("all");
  const [licenciadoFilter, setLicenciadoFilter] = useState<Set<string>>(new Set());
  const [only48h, setOnly48h] = useState(false);
  const [dddFilter, setDddFilter] = useState<Set<string>>(new Set());
  const [selectedDbIds, setSelectedDbIds] = useState<Set<string>>(new Set());

  // Extract tab state
  const [extractLoading, setExtractLoading] = useState(false);
  const [phoneContacts, setPhoneContacts] = useState<EvolutionContact[]>([]);
  const [groups, setGroups] = useState<EvolutionGroup[]>([]);
  const [selectedGroupJid, setSelectedGroupJid] = useState<string | null>(null);
  const [groupParticipants, setGroupParticipants] = useState<EvolutionGroupParticipant[]>([]);
  const [groupParticipantsLoading, setGroupParticipantsLoading] = useState(false);
  const [selectedExtractIds, setSelectedExtractIds] = useState<Set<string>>(new Set());
  const [extractSearch, setExtractSearch] = useState("");
  const [extractMode, setExtractMode] = useState<"contacts" | "groups">("contacts");

  const { toast } = useToast();

  const licenciadoOptions = useMemo(() => {
    const names = new Set<string>();
    customers.forEach(c => { if (c.registered_by_name) names.add(c.registered_by_name); });
    return Array.from(names).sort();
  }, [customers]);

  const dddOptions = useMemo(() => {
    const set = new Set<string>();
    customers.forEach(c => {
      const ddd = getDdd(c.phone_whatsapp);
      if (ddd) set.add(ddd);
    });
    return Array.from(set).sort();
  }, [customers]);

  const filteredCustomers = useMemo(() => {
    let list = customers;
    if (statusFilter !== "all") list = list.filter(c => c.status === statusFilter);
    if (devolutivaFilter !== "all") list = list.filter(c => matchDevolutiva(c.devolutiva, devolutivaFilter));
    if (licenciadoFilter.size > 0) list = list.filter(c => c.registered_by_name != null && licenciadoFilter.has(c.registered_by_name));
    if (only48h) {
      const cutoff = Date.now() - FORTY_EIGHT_HOURS_MS;
      list = list.filter(c => c.last_inbound_at != null && new Date(c.last_inbound_at).getTime() >= cutoff);
    }
    if (dddFilter.size > 0) {
      list = list.filter(c => {
        const d = getDdd(c.phone_whatsapp);
        return d != null && dddFilter.has(d);
      });
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(c => (c.name && c.name.toLowerCase().includes(q)) || c.phone_whatsapp.toLowerCase().includes(q));
    }
    return list;
  }, [customers, statusFilter, devolutivaFilter, licenciadoFilter, only48h, dddFilter, searchQuery]);

  const validDbCount = useMemo(() => filteredCustomers.filter(c => isValidPhone(c.phone_whatsapp)).length, [filteredCustomers]);

  const allValidSelected = useMemo(() => {
    const valid = filteredCustomers.filter(c => isValidPhone(c.phone_whatsapp));
    return valid.length > 0 && valid.every(c => selectedDbIds.has(c.id));
  }, [filteredCustomers, selectedDbIds]);

  const toggleAll = useCallback(() => {
    if (allValidSelected) {
      setSelectedDbIds(prev => {
        const n = new Set(prev);
        filteredCustomers.filter(c => isValidPhone(c.phone_whatsapp)).forEach(c => n.delete(c.id));
        return n;
      });
    } else {
      setSelectedDbIds(prev => {
        const n = new Set(prev);
        filteredCustomers.filter(c => isValidPhone(c.phone_whatsapp)).forEach(c => n.add(c.id));
        return n;
      });
    }
  }, [allValidSelected, filteredCustomers]);

  const addFromDatabase = useCallback(() => {
    const selected = customers.filter(c => selectedDbIds.has(c.id) && isValidPhone(c.phone_whatsapp));
    const existing = new Set(contacts.map(c => c.phone));
    const newContacts: BulkContact[] = selected
      .filter(c => !existing.has(c.phone_whatsapp))
      .map(c => ({
        id: c.id,
        name: c.name || c.phone_whatsapp,
        phone: c.phone_whatsapp,
        electricity_bill_value: c.electricity_bill_value,
        source: "database" as const,
      }));
    onContactsChange([...contacts, ...newContacts]);
    setSelectedDbIds(new Set());
    toast({ title: `${newContacts.length} contatos adicionados`, description: `Total: ${contacts.length + newContacts.length}` });
  }, [customers, selectedDbIds, contacts, onContactsChange, toast]);

  const parsePastedContacts = useCallback(() => {
    const lines = pasteText.trim().split("\n").filter(l => l.trim());
    const existing = new Set(contacts.map(c => c.phone));
    const parsed: BulkContact[] = [];
    for (const line of lines) {
      const parts = line.split(/[;,\t]/).map(p => p.trim()).filter(Boolean);
      if (parts.length < 1) continue;
      let name = "", phone = "";
      if (parts.length === 1) {
        phone = parts[0].replace(/\D/g, "");
        name = phone;
      } else {
        const first = parts[0].replace(/\D/g, "");
        if (first.length >= 10) { phone = first; name = parts[1]; }
        else { name = parts[0]; phone = parts[1].replace(/\D/g, ""); }
      }
      if (phone.length >= 10 && !existing.has(phone)) {
        existing.add(phone);
        parsed.push({ id: `paste-${phone}`, name, phone, source: "pasted" });
      }
    }
    onContactsChange([...contacts, ...parsed]);
    setPasteText("");
    toast({ title: `${parsed.length} contatos colados`, description: `Total: ${contacts.length + parsed.length}` });
  }, [pasteText, contacts, onContactsChange, toast]);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target?.result, { type: "binary" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws);
        const existing = new Set(contacts.map(c => c.phone));
        const parsed: BulkContact[] = [];
        for (const row of rows) {
          const name = (row.nome || row.Nome || row.name || row.Name || "").toString().trim();
          const rawPhone = (row.telefone || row.Telefone || row.phone || row.Phone || row.celular || row.Celular || "").toString().trim();
          const phone = rawPhone.replace(/\D/g, "");
          if (phone.length >= 10 && !existing.has(phone)) {
            existing.add(phone);
            parsed.push({ id: `import-${phone}`, name: name || phone, phone, source: "imported" });
          }
        }
        onContactsChange([...contacts, ...parsed]);
        toast({ title: `${parsed.length} contatos importados`, description: `Total: ${contacts.length + parsed.length}` });
      } catch {
        toast({ title: "Erro ao ler arquivo", variant: "destructive" });
      }
    };
    reader.readAsBinaryString(file);
    e.target.value = "";
  }, [contacts, onContactsChange, toast]);

  const downloadTemplate = useCallback(() => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["nome", "telefone"],
      ["João Silva", "5511999998888"],
      ["Maria Souza", "5521988887777"],
    ]);
    ws["!cols"] = [{ wch: 25 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, ws, "Contatos");
    XLSX.writeFile(wb, "modelo_importacao.xlsx");
  }, []);

  const removeContact = useCallback((id: string) => {
    onContactsChange(contacts.filter(c => c.id !== id));
  }, [contacts, onContactsChange]);

  const clearAll = useCallback(() => {
    onContactsChange([]);
  }, [onContactsChange]);

  // ─── Extract: Load phone contacts ───
  const loadPhoneContacts = useCallback(async () => {
    if (!instanceName) { toast({ title: "WhatsApp não conectado", variant: "destructive" }); return; }
    setExtractLoading(true);
    try {
      const all = await findContacts(instanceName);
      const filtered = all.filter(c => {
        const jid = c.remoteJid || c.id;
        return jid.endsWith("@s.whatsapp.net") && !jid.startsWith("0@") && !jid.startsWith("status@");
      });
      setPhoneContacts(filtered);
      toast({ title: `${filtered.length} contatos carregados do celular` });
    } catch {
      toast({ title: "Erro ao carregar contatos", variant: "destructive" });
    } finally {
      setExtractLoading(false);
    }
  }, [instanceName, toast]);

  const loadGroups = useCallback(async () => {
    if (!instanceName) { toast({ title: "WhatsApp não conectado", variant: "destructive" }); return; }
    setExtractLoading(true);
    try {
      const allGroups = await fetchAllGroups(instanceName);
      setGroups(allGroups);
      toast({ title: `${allGroups.length} grupos encontrados` });
    } catch {
      toast({ title: "Erro ao carregar grupos", variant: "destructive" });
    } finally {
      setExtractLoading(false);
    }
  }, [instanceName, toast]);

  const loadGroupParticipants = useCallback(async (groupJid: string) => {
    if (!instanceName) return;
    setGroupParticipantsLoading(true);
    setSelectedGroupJid(groupJid);
    setSelectedExtractIds(new Set());
    try {
      const group = groups.find(g => g.id === groupJid);
      if (group?.participants && group.participants.length > 0) {
        setGroupParticipants(group.participants);
      } else {
        const participants = await getGroupParticipants(instanceName, groupJid);
        setGroupParticipants(participants);
      }
    } catch {
      toast({ title: "Erro ao carregar participantes", variant: "destructive" });
    } finally {
      setGroupParticipantsLoading(false);
    }
  }, [instanceName, groups, toast]);

  const addExtractedToList = useCallback(() => {
    const existing = new Set(contacts.map(c => c.phone));
    const newContacts: BulkContact[] = [];

    if (extractMode === "contacts") {
      for (const contact of phoneContacts) {
        const jid = contact.remoteJid || contact.id;
        if (!selectedExtractIds.has(jid)) continue;
        const phone = jid.split("@")[0];
        if (!isValidPhone(phone) || existing.has(phone)) continue;
        existing.add(phone);
        newContacts.push({ id: `contact-${phone}`, name: contact.pushName || phone, phone, source: "pasted" as const });
      }
    } else {
      for (const p of groupParticipants) {
        if (!selectedExtractIds.has(p.id)) continue;
        const phone = p.id.split("@")[0];
        if (!isValidPhone(phone) || existing.has(phone)) continue;
        existing.add(phone);
        newContacts.push({ id: `group-${phone}`, name: phone, phone, source: "pasted" as const });
      }
    }

    onContactsChange([...contacts, ...newContacts]);
    setSelectedExtractIds(new Set());
    toast({ title: `${newContacts.length} contatos adicionados`, description: `Total: ${contacts.length + newContacts.length}` });
  }, [contacts, onContactsChange, phoneContacts, groupParticipants, selectedExtractIds, extractMode, toast]);

  const exportExtractToExcel = useCallback(() => {
    const wb = XLSX.utils.book_new();
    if (extractMode === "contacts" && phoneContacts.length > 0) {
      const data = phoneContacts.map(c => ({
        Nome: c.pushName || "",
        Telefone: (c.remoteJid || c.id).split("@")[0],
        "Telefone Formatado": formatPhone((c.remoteJid || c.id).split("@")[0]),
      }));
      const ws = XLSX.utils.json_to_sheet(data);
      ws["!cols"] = [{ wch: 30 }, { wch: 18 }, { wch: 20 }];
      XLSX.utils.book_append_sheet(wb, ws, "Contatos do Celular");
      XLSX.writeFile(wb, "contatos_celular.xlsx");
      toast({ title: `${data.length} contatos exportados para Excel` });
    } else if (extractMode === "groups" && selectedGroupJid && groupParticipants.length > 0) {
      const groupName = groups.find(g => g.id === selectedGroupJid)?.subject || "Grupo";
      const safeSheetName = groupName.replace(/[\\/*?:\[\]]/g, "").slice(0, 31);
      const data = groupParticipants.map(p => ({
        Telefone: p.id.split("@")[0],
        "Telefone Formatado": formatPhone(p.id.split("@")[0]),
        Admin: p.admin ? "Sim" : "Não",
      }));
      const ws = XLSX.utils.json_to_sheet(data);
      ws["!cols"] = [{ wch: 18 }, { wch: 20 }, { wch: 8 }];
      XLSX.utils.book_append_sheet(wb, ws, safeSheetName);
      XLSX.writeFile(wb, `grupo_${safeSheetName}.xlsx`);
      toast({ title: `${data.length} participantes exportados` });
    } else {
      toast({ title: "Nenhum dado para exportar", variant: "destructive" });
    }
  }, [extractMode, phoneContacts, groups, selectedGroupJid, groupParticipants, toast]);

  const filteredPhoneContacts = useMemo(() => {
    if (!extractSearch.trim()) return phoneContacts;
    const q = extractSearch.toLowerCase();
    return phoneContacts.filter(c => {
      const name = c.pushName || "";
      const phone = (c.remoteJid || c.id).split("@")[0];
      return name.toLowerCase().includes(q) || phone.includes(q);
    });
  }, [phoneContacts, extractSearch]);

  const filteredGroupParticipants = useMemo(() => {
    if (!extractSearch.trim()) return groupParticipants;
    const q = extractSearch.toLowerCase();
    return groupParticipants.filter(p => p.id.split("@")[0].includes(q));
  }, [groupParticipants, extractSearch]);

  const validContacts = useMemo(() => contacts.filter(c => isValidPhone(c.phone)), [contacts]);
  const invalidContacts = contacts.length - validContacts.length;

  return (
    <div className="space-y-3">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4 h-9">
          <TabsTrigger value="database" className="text-xs gap-1" disabled={disabled}>
            <Users className="w-3.5 h-3.5" /> Base
          </TabsTrigger>
          <TabsTrigger value="extract" className="text-xs gap-1" disabled={disabled}>
            <Globe className="w-3.5 h-3.5" /> Extrair
          </TabsTrigger>
          <TabsTrigger value="paste" className="text-xs gap-1" disabled={disabled}>
            <ClipboardPaste className="w-3.5 h-3.5" /> Colar
          </TabsTrigger>
          <TabsTrigger value="import" className="text-xs gap-1" disabled={disabled}>
            <FileSpreadsheet className="w-3.5 h-3.5" /> Importar
          </TabsTrigger>
        </TabsList>

        {/* ─── DATABASE TAB ─── */}
        <TabsContent value="database" className="space-y-2 mt-2">
          <div className="flex flex-wrap gap-1.5">
            {(["all", "approved", "rejected", "pending"] as const).map(f => (
              <button key={f} onClick={() => { setStatusFilter(f); setDevolutivaFilter("all"); }}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all ${
                  statusFilter === f ? "bg-primary/20 border-primary/40 text-primary" : "bg-secondary/40 border-border/50 text-muted-foreground hover:bg-secondary/60"
                }`}>
                {f === "all" ? "Todos" : f === "approved" ? "Aprovado" : f === "rejected" ? "Reprovado" : "Pendente"}
              </button>
            ))}
          </div>

          {statusFilter === "rejected" && (
            <Select value={devolutivaFilter} onValueChange={setDevolutivaFilter}>
              <SelectTrigger className="rounded-lg bg-secondary/50 border-border/50 h-8 text-xs">
                <SelectValue placeholder="Filtrar devolutiva..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as devolutivas</SelectItem>
                {DEVOLUTIVA_CATEGORIES.map(cat => (
                  <SelectItem key={cat.key} value={cat.key}>{cat.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {licenciadoOptions.length > 0 && (
            <Popover>
              <PopoverTrigger asChild>
                <button className="w-full flex items-center gap-2 rounded-lg bg-secondary/50 border border-border/50 text-xs px-3 py-1.5 text-left hover:bg-secondary/70">
                  <Users className="w-3 h-3 text-muted-foreground" />
                  <span className="flex-1 truncate text-muted-foreground">
                    {licenciadoFilter.size === 0 ? "Todos os licenciados" : `${licenciadoFilter.size} selecionados`}
                  </span>
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-0" align="start">
                <div className="max-h-44 overflow-y-auto p-1.5 space-y-0.5">
                  {licenciadoOptions.map(name => (
                    <label key={name} className="flex items-center gap-2 px-2 py-1 rounded cursor-pointer hover:bg-secondary/50 text-xs">
                      <Checkbox checked={licenciadoFilter.has(name)} onCheckedChange={(checked) => {
                        setLicenciadoFilter(prev => { const n = new Set(prev); checked ? n.add(name) : n.delete(name); return n; });
                      }} />
                      <span className="truncate">{name}</span>
                    </label>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          )}

          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setOnly48h(v => !v)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all ${
                only48h ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300" : "bg-secondary/40 border-border/50 text-muted-foreground hover:bg-secondary/60"
              }`}
            >
              <MessageSquare className="w-3 h-3" />
              Últimas 48h no WhatsApp
              {only48h && <X className="w-3 h-3" />}
            </button>

            {dddOptions.length > 0 && (
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all ${
                      dddFilter.size > 0 ? "bg-primary/20 border-primary/40 text-primary" : "bg-secondary/40 border-border/50 text-muted-foreground hover:bg-secondary/60"
                    }`}
                  >
                    <MapPin className="w-3 h-3" />
                    {dddFilter.size === 0 ? "Filtrar por DDD" : `DDD: ${Array.from(dddFilter).sort().join(", ")}`}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-56 p-0" align="start">
                  <div className="flex items-center justify-between px-2 py-1.5 border-b border-border/50">
                    <span className="text-[11px] font-semibold text-muted-foreground">Escolha os DDDs</span>
                    {dddFilter.size > 0 && (
                      <button onClick={() => setDddFilter(new Set())} className="text-[10px] text-primary hover:underline">
                        Limpar
                      </button>
                    )}
                  </div>
                  <div className="max-h-52 overflow-y-auto p-1.5 grid grid-cols-3 gap-0.5">
                    {dddOptions.map(d => (
                      <label key={d} className="flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer hover:bg-secondary/50 text-xs">
                        <Checkbox checked={dddFilter.has(d)} onCheckedChange={(checked) => {
                          setDddFilter(prev => { const n = new Set(prev); checked ? n.add(d) : n.delete(d); return n; });
                        }} />
                        <span className="font-mono">{d}</span>
                      </label>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            )}
          </div>


          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input placeholder="Buscar por nome ou telefone..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              className="pl-8 h-8 text-xs rounded-lg bg-secondary/50 border-border/50" />
          </div>

          <div className="flex items-center justify-between px-1">
            <label className="flex items-center gap-2 cursor-pointer text-xs">
              <Checkbox checked={allValidSelected} onCheckedChange={toggleAll} />
              <CheckSquare className="w-3 h-3 text-muted-foreground" /> Selecionar válidos ({validDbCount})
            </label>
            <span className="text-[11px] text-primary font-bold">{selectedDbIds.size} marcados</span>
          </div>

          <div className="max-h-52 overflow-y-auto rounded-xl border border-border/50 divide-y divide-border/20">
            {filteredCustomers.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6">Nenhum cliente encontrado</p>
            ) : filteredCustomers.map(c => (
              <ContactRow
                key={c.id}
                name={c.name || c.phone_whatsapp}
                phone={c.phone_whatsapp}
                valid={isValidPhone(c.phone_whatsapp)}
                selected={selectedDbIds.has(c.id)}
                onToggle={() => setSelectedDbIds(prev => { const n = new Set(prev); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n; })}
                status={c.status}
              />
            ))}
          </div>

          <Button size="sm" onClick={addFromDatabase} disabled={selectedDbIds.size === 0}
            className="w-full gap-1.5 rounded-lg h-9 text-xs font-bold">
            <Users className="w-3.5 h-3.5" /> Adicionar {selectedDbIds.size} contatos à lista
          </Button>
        </TabsContent>

        {/* ─── EXTRACT TAB ─── */}
        <TabsContent value="extract" className="space-y-3 mt-2">
          <div className="flex gap-1.5">
            <button onClick={() => { setExtractMode("contacts"); setExtractSearch(""); setSelectedExtractIds(new Set()); }}
              className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all flex items-center justify-center gap-1.5 ${
                extractMode === "contacts" ? "bg-primary/20 border-primary/40 text-primary" : "bg-secondary/40 border-border/50 text-muted-foreground hover:bg-secondary/60"
              }`}>
              <UserCircle className="w-3.5 h-3.5" /> Contatos do Celular
            </button>
            <button onClick={() => { setExtractMode("groups"); setExtractSearch(""); setSelectedExtractIds(new Set()); }}
              className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all flex items-center justify-center gap-1.5 ${
                extractMode === "groups" ? "bg-primary/20 border-primary/40 text-primary" : "bg-secondary/40 border-border/50 text-muted-foreground hover:bg-secondary/60"
              }`}>
              <Users className="w-3.5 h-3.5" /> Grupos
            </button>
          </div>

          {extractMode === "contacts" && (
            <>
              <Button size="sm" onClick={loadPhoneContacts} disabled={extractLoading || !instanceName}
                className="w-full gap-1.5 rounded-lg h-9 text-xs" variant="outline">
                {extractLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserCircle className="w-3.5 h-3.5" />}
                {extractLoading ? "Carregando..." : `Carregar Contatos${phoneContacts.length > 0 ? ` (${phoneContacts.length})` : ""}`}
              </Button>

              {phoneContacts.length > 0 && (
                <>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    <Input placeholder="Buscar contato..." value={extractSearch} onChange={e => setExtractSearch(e.target.value)}
                      className="pl-8 h-8 text-xs rounded-lg bg-secondary/50 border-border/50" />
                  </div>

                  <div className="flex items-center justify-between px-1">
                    <label className="flex items-center gap-2 cursor-pointer text-xs">
                      <Checkbox
                        checked={filteredPhoneContacts.length > 0 && filteredPhoneContacts.every(c => selectedExtractIds.has(c.remoteJid || c.id))}
                        onCheckedChange={(checked) => {
                          setSelectedExtractIds(prev => {
                            const n = new Set(prev);
                            filteredPhoneContacts.forEach(c => { const jid = c.remoteJid || c.id; checked ? n.add(jid) : n.delete(jid); });
                            return n;
                          });
                        }}
                      />
                      <span>Selecionar todos ({filteredPhoneContacts.length})</span>
                    </label>
                    <span className="text-[11px] text-primary font-bold">{selectedExtractIds.size} marcados</span>
                  </div>

                  <div className="max-h-52 overflow-y-auto rounded-xl border border-border/50 divide-y divide-border/20">
                    {filteredPhoneContacts.map(c => {
                      const jid = c.remoteJid || c.id;
                      const phone = jid.split("@")[0];
                      return (
                        <ContactRow key={jid} name={c.pushName || phone} phone={phone}
                          valid={isValidPhone(phone)} selected={selectedExtractIds.has(jid)}
                          onToggle={() => setSelectedExtractIds(prev => { const n = new Set(prev); n.has(jid) ? n.delete(jid) : n.add(jid); return n; })}
                        />
                      );
                    })}
                  </div>

                  <div className="flex gap-2">
                    <Button size="sm" onClick={addExtractedToList} disabled={selectedExtractIds.size === 0}
                      className="flex-1 gap-1.5 rounded-lg h-9 text-xs font-bold">
                      <Users className="w-3.5 h-3.5" /> Adicionar {selectedExtractIds.size}
                    </Button>
                    <Button size="sm" onClick={exportExtractToExcel} variant="outline"
                      className="gap-1.5 rounded-lg h-9 text-xs">
                      <Download className="w-3.5 h-3.5" /> Excel
                    </Button>
                  </div>
                </>
              )}
            </>
          )}

          {extractMode === "groups" && (
            <>
              <Button size="sm" onClick={loadGroups} disabled={extractLoading || !instanceName}
                className="w-full gap-1.5 rounded-lg h-9 text-xs" variant="outline">
                {extractLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Users className="w-3.5 h-3.5" />}
                {extractLoading ? "Carregando..." : `Carregar Grupos${groups.length > 0 ? ` (${groups.length})` : ""}`}
              </Button>

              {groups.length > 0 && (
                <>
                  <div className="max-h-40 overflow-y-auto rounded-xl border border-border/50 divide-y divide-border/20">
                    {groups.map(g => (
                      <button key={g.id} onClick={() => loadGroupParticipants(g.id)}
                        className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors ${
                          selectedGroupJid === g.id ? "bg-primary/10" : "hover:bg-secondary/40"
                        }`}>
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${getAvatarColor(g.subject)}`}>
                          {getInitials(g.subject)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-foreground truncate">{g.subject}</p>
                          <p className="text-[11px] text-muted-foreground">{g.size || "?"} participantes</p>
                        </div>
                        {selectedGroupJid === g.id && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-primary/20 text-primary border border-primary/30">Selecionado</span>
                        )}
                      </button>
                    ))}
                  </div>

                  {selectedGroupJid && (
                    <>
                      {groupParticipantsLoading ? (
                        <div className="flex items-center justify-center py-6 gap-2">
                          <Loader2 className="w-4 h-4 animate-spin text-primary" />
                          <span className="text-xs text-muted-foreground">Carregando participantes...</span>
                        </div>
                      ) : groupParticipants.length > 0 ? (
                        <>
                          <div className="relative">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                            <Input placeholder="Buscar participante..." value={extractSearch} onChange={e => setExtractSearch(e.target.value)}
                              className="pl-8 h-8 text-xs rounded-lg bg-secondary/50 border-border/50" />
                          </div>

                          <div className="flex items-center justify-between px-1">
                            <label className="flex items-center gap-2 cursor-pointer text-xs">
                              <Checkbox
                                checked={filteredGroupParticipants.length > 0 && filteredGroupParticipants.every(p => selectedExtractIds.has(p.id))}
                                onCheckedChange={(checked) => {
                                  setSelectedExtractIds(prev => {
                                    const n = new Set(prev);
                                    filteredGroupParticipants.forEach(p => { checked ? n.add(p.id) : n.delete(p.id); });
                                    return n;
                                  });
                                }}
                              />
                              <span>Selecionar todos ({filteredGroupParticipants.length})</span>
                            </label>
                            <span className="text-[11px] text-primary font-bold">{selectedExtractIds.size} marcados</span>
                          </div>

                          <div className="max-h-44 overflow-y-auto rounded-xl border border-border/50 divide-y divide-border/20">
                            {filteredGroupParticipants.map(p => {
                              const phone = p.id.split("@")[0];
                              return (
                                <ContactRow key={p.id} name={phone} phone={phone}
                                  valid={isValidPhone(phone)} selected={selectedExtractIds.has(p.id)}
                                  onToggle={() => setSelectedExtractIds(prev => { const n = new Set(prev); n.has(p.id) ? n.delete(p.id) : n.add(p.id); return n; })}
                                />
                              );
                            })}
                          </div>

                          <div className="flex gap-2">
                            <Button size="sm" onClick={addExtractedToList} disabled={selectedExtractIds.size === 0}
                              className="flex-1 gap-1.5 rounded-lg h-9 text-xs font-bold">
                              <Users className="w-3.5 h-3.5" /> Adicionar {selectedExtractIds.size}
                            </Button>
                            <Button size="sm" onClick={exportExtractToExcel} variant="outline"
                              className="gap-1.5 rounded-lg h-9 text-xs">
                              <Download className="w-3.5 h-3.5" /> Excel
                            </Button>
                          </div>
                        </>
                      ) : (
                        <p className="text-xs text-muted-foreground text-center py-4">Nenhum participante encontrado</p>
                      )}
                    </>
                  )}
                </>
              )}
            </>
          )}
        </TabsContent>

        {/* ─── PASTE TAB ─── */}
        <TabsContent value="paste" className="space-y-3 mt-2">
          <div className="rounded-lg bg-primary/5 border border-primary/20 p-2.5 space-y-1.5">
            <p className="text-xs font-semibold text-foreground">Como funciona</p>
            <p className="text-[11px] text-muted-foreground leading-snug">
              Cole <strong>um contato por linha</strong>. Aceita qualquer um destes formatos —
              o sistema descobre sozinho:
            </p>
            <ul className="text-[11px] text-muted-foreground space-y-0.5 pl-3 list-disc">
              <li><code className="px-1 bg-secondary rounded text-primary">11999998888</code> (só o telefone)</li>
              <li><code className="px-1 bg-secondary rounded text-primary">João Silva 11999998888</code> (nome e telefone, do jeito que vier)</li>
              <li><code className="px-1 bg-secondary rounded text-primary">João;11999998888</code> ou com vírgula / tab (colado do Excel funciona)</li>
            </ul>
          </div>
          <Textarea
            placeholder={"João Silva 11999998888\nMaria 21988887777\n11977776666"}
            value={pasteText}
            onChange={e => setPasteText(e.target.value)}
            rows={6}
            className="rounded-lg bg-secondary/30 border-border/40 resize-none text-xs font-mono"
          />
          <Button size="sm" onClick={parsePastedContacts} disabled={!pasteText.trim()}
            className="w-full gap-1.5 rounded-lg h-9 text-xs font-bold">
            <ClipboardPaste className="w-3.5 h-3.5" /> Adicionar contatos colados
          </Button>
        </TabsContent>

        {/* ─── IMPORT TAB ─── */}
        <TabsContent value="import" className="space-y-3 mt-2">
          <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/20 p-2.5 space-y-2">
            <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-500" />
              Jeito mais fácil: usar o Google Planilhas
            </p>
            <ol className="text-[11px] text-muted-foreground space-y-0.5 pl-4 list-decimal">
              <li>Clique em <strong>"Abrir Google Planilhas"</strong> — abre uma planilha em branco.</li>
              <li>Crie 2 colunas: <code className="px-1 bg-secondary rounded text-primary">nome</code> e <code className="px-1 bg-secondary rounded text-primary">telefone</code>.</li>
              <li>Cole ou digite seus contatos.</li>
              <li>Em <em>Arquivo → Baixar → Excel (.xlsx)</em> e envie aqui embaixo.</li>
            </ol>
            <Button
              type="button"
              size="sm"
              variant="default"
              asChild
              className="w-full gap-1.5 rounded-lg h-9 text-xs font-bold"
            >
              <a
                href="https://docs.google.com/spreadsheets/create?title=Contatos%20WhatsApp"
                target="_blank"
                rel="noopener noreferrer"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" /> Abrir Google Planilhas
              </a>
            </Button>
          </div>

          <div className="space-y-1.5">
            <p className="text-[11px] text-muted-foreground">
              Ou baixe um modelo pronto em Excel (mesmo formato):
            </p>
            <Button variant="outline" size="sm" onClick={downloadTemplate} className="gap-1.5 rounded-lg h-8 text-xs">
              <Download className="w-3.5 h-3.5" /> Baixar modelo .xlsx
            </Button>
          </div>

          <div className="space-y-1.5 border-t pt-2.5">
            <p className="text-[11px] text-muted-foreground font-medium">
              Envie sua planilha (.xlsx, .xls ou .csv):
            </p>
            <Input type="file" accept=".xlsx,.xls,.csv" onChange={handleFileUpload}
              className="text-xs rounded-lg h-9 file:text-xs file:mr-2" />
          </div>
        </TabsContent>
      </Tabs>

      {/* ─── CONTACT SUMMARY ─── */}
      {contacts.length > 0 && (
        <div className="rounded-xl border border-border/50 bg-secondary/10 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-foreground">
              📋 {contacts.length} contatos na lista
            </span>
            <Button variant="ghost" size="sm" onClick={clearAll} disabled={disabled}
              className="h-6 px-2 text-[10px] text-destructive hover:text-destructive gap-1">
              <Trash2 className="w-3 h-3" /> Limpar
            </Button>
          </div>
          <div className="flex flex-wrap gap-2 text-[11px]">
            <span className="text-green-400">✓ {validContacts.length} válidos</span>
            {invalidContacts > 0 && <span className="text-red-400">✗ {invalidContacts} inválidos</span>}
            {contacts.filter(c => c.source === "database").length > 0 && (
              <span className="text-muted-foreground">Base: {contacts.filter(c => c.source === "database").length}</span>
            )}
            {contacts.filter(c => c.source === "pasted").length > 0 && (
              <span className="text-muted-foreground">Colados: {contacts.filter(c => c.source === "pasted").length}</span>
            )}
            {contacts.filter(c => c.source === "imported").length > 0 && (
              <span className="text-muted-foreground">Importados: {contacts.filter(c => c.source === "imported").length}</span>
            )}
          </div>
          <div className="max-h-40 overflow-y-auto rounded-lg divide-y divide-border/20">
            {contacts.map(c => (
              <div key={c.id} className="flex items-center gap-2.5 px-2 py-1.5 hover:bg-secondary/40 rounded">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${getAvatarColor(c.name)}`}>
                  {getInitials(c.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-foreground truncate leading-tight">{c.name}</p>
                  <p className="text-[11px] text-muted-foreground">{formatPhone(c.phone)}</p>
                </div>
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${
                  c.source === "database" ? "bg-blue-500/15 text-blue-400" :
                  c.source === "pasted" ? "bg-purple-500/15 text-purple-400" :
                  "bg-green-500/15 text-green-400"
                }`}>{c.source === "database" ? "Base" : c.source === "pasted" ? "Colado" : "Importado"}</span>
                {!disabled && (
                  <button onClick={() => removeContact(c.id)} className="p-0.5 rounded hover:bg-secondary text-muted-foreground hover:text-destructive">
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
