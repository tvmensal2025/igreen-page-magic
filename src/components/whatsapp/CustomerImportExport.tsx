import { useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Upload, FileSpreadsheet, CheckCircle2, X, Loader2, Phone, MapPin,
} from "lucide-react";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { supabase } from "@/integrations/supabase/client";
import type { TablesInsert } from "@/integrations/supabase/types";
import {
  type Customer, type ParsedCustomer,
  normalizePhone, safeString, findColumnValue, mapStatus,
  buildCustomerData, getStatusBadge, formatPhoneDisplay,
} from "./customerUtils";

interface CustomerImportExportProps {
  customers: Customer[];
  filtered: Customer[];
  consultantId: string;
  onCustomersChange: () => void;
  /** Quando true, renderiza Exportar/Importar como itens de menu (dropdown). */
  asMenuItems?: boolean;
}

export function CustomerImportExport({ customers, filtered, consultantId, onCustomersChange, asMenuItems = false }: CustomerImportExportProps) {
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0, newCount: 0, updatedCount: 0, errorCount: 0 });
  const [showImportResult, setShowImportResult] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [parsedCustomers, setParsedCustomers] = useState<ParsedCustomer[]>([]);
  const [selectedPhones, setSelectedPhones] = useState<Set<string>>(new Set());
  const [parsing, setParsing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  async function handleFileSelected(file: File) {
    setParsing(true);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet);

      const existingPhones = new Set(customers.map((c) => c.phone_whatsapp.replace(/\D/g, "")));
      const seenPhones = new Set<string>();
      const parsed: ParsedCustomer[] = [];

      for (const row of rows) {
        const phoneRaw = findColumnValue(row, "Celular", "celular", "Telefone", "telefone", "WhatsApp", "whatsapp", "Fone", "Phone");
        let phone = normalizePhone(String(phoneRaw || ""));

        if (!phone || phone.length < 12) {
          const codigo = safeString(findColumnValue(row, "Código", "Codigo", "código", "codigo"));
          const instalacao = safeString(findColumnValue(row, "Instalação", "Instalacao", "Nº Instalação", "N Instalacao"));
          const fallbackId = codigo || instalacao;
          if (fallbackId) {
            phone = `sem_celular_${fallbackId.replace(/\D/g, "")}`;
          } else {
            continue;
          }
        }
        if (seenPhones.has(phone)) continue;
        seenPhones.add(phone);

        const name = safeString(findColumnValue(row, "Nome do Cliente", "Nome", "nome", "NOME", "Cliente", "Name"));
        const statusRaw = safeString(findColumnValue(row, "Andamento", "Status", "status")) || undefined;
        const isNew = !existingPhones.has(phone);

        parsed.push({ phone, name, status: mapStatus(statusRaw), hasStatus: !!statusRaw, data: buildCustomerData(row), isNew });
      }

      setParsedCustomers(parsed);
      setSelectedPhones(new Set(parsed.map((p) => p.phone)));
      setShowPreview(true);
    } catch (err) {
      toast({ title: "Erro ao ler arquivo", description: err instanceof Error ? err.message : "Erro", variant: "destructive" });
    } finally {
      setParsing(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function toggleSelect(phone: string) {
    setSelectedPhones((prev) => {
      const next = new Set(prev);
      if (next.has(phone)) next.delete(phone); else next.add(phone);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedPhones.size === parsedCustomers.length) setSelectedPhones(new Set());
    else setSelectedPhones(new Set(parsedCustomers.map((p) => p.phone)));
  }

  async function handleConfirmImport() {
    const toImport = parsedCustomers.filter((p) => selectedPhones.has(p.phone));
    if (toImport.length === 0) { toast({ title: "Nenhum cliente selecionado" }); return; }

    setShowPreview(false);
    setImporting(true);
    setShowImportResult(false);
    const progress = { current: 0, total: toImport.length, newCount: 0, updatedCount: 0, errorCount: 0 };
    setImportProgress({ ...progress });

    const BATCH_SIZE = 100;
    for (let i = 0; i < toImport.length; i += BATCH_SIZE) {
      const batch = toImport.slice(i, i + BATCH_SIZE);
      const batchData = batch.map((item) => {
        const row: Record<string, unknown> = {
          phone_whatsapp: item.phone,
          consultant_id: consultantId,
          // Importação por planilha = carteira/pós-venda. NUNCA vira lead do WhatsApp
          // nem entra no funil do CRM. Para isso, marcamos a origem como igreen_sync.
          customer_origin: "igreen_sync",
          ...item.data,
        };
        // Em cliente já existente, só sobrescreve nome/status quando a planilha
        // realmente trouxe o valor — planilha sem coluna não pode apagar o nome
        // nem rebaixar um cliente aprovado para "pendente".
        if (item.name || item.isNew) row.name = item.name;
        if (item.hasStatus || item.isNew) row.status = item.status;
        return row;
      }) as TablesInsert<"customers">[];


      try {
        const { data: upserted, error } = await supabase
          .from("customers")
          .upsert(batchData, { onConflict: "phone_whatsapp" })
          .select("id, phone_whatsapp");
        if (error) throw error;

        if (upserted && upserted.length > 0) {
          // NÃO criamos crm_deals aqui — Excel é carteira, não lead.
          const newPhones = new Set(batch.filter((b) => b.isNew).map((b) => b.phone));
          for (const u of upserted) {
            if (newPhones.has(u.phone_whatsapp)) progress.newCount++;
            else progress.updatedCount++;
          }
        }
      } catch (err) {
        console.error("[import] Batch error at offset", i, err);
        progress.errorCount += batch.length;
      }
      progress.current = Math.min(i + BATCH_SIZE, toImport.length);
      setImportProgress({ ...progress });
    }

    setShowImportResult(true);
    setImporting(false);
    toast({ title: "✅ Importação concluída!", description: `${progress.newCount} novos, ${progress.updatedCount} atualizados${progress.errorCount > 0 ? `, ${progress.errorCount} erros` : ""}` });
    onCustomersChange();
    await queryClient.invalidateQueries({ queryKey: ["analytics", consultantId] });
  }

  function handleExport() {
    const exportData = filtered.map((c) => ({
      // Dados Pessoais
      "Nome": c.name || "",
      "CPF": c.cpf || "",
      "RG": c.rg || "",
      "Email": c.email || "",
      "Telefone": c.phone_whatsapp,
      "Data Nascimento": c.data_nascimento || "",
      // Endereço
      "Rua": c.address_street || "",
      "Número": c.address_number || "",
      "Complemento": c.address_complement || "",
      "Bairro": c.address_neighborhood || "",
      "Cidade": c.address_city || "",
      "Estado": c.address_state || "",
      "CEP": c.cep || "",
      // Energia
      "Distribuidora": c.distribuidora || "",
      "Nº Instalação": c.numero_instalacao || "",
      "Consumo Médio (kW)": c.media_consumo ?? "",
      "Valor Conta (R$)": c.electricity_bill_value ?? "",
      "Desconto Cliente (%)": c.desconto_cliente ?? "",
      // Tipo Produto
      "Tipo Produto": c.tipo_produto || "energia",
      // iGreen
      "Código iGreen": c.igreen_code || "",
      "Andamento": c.andamento_igreen || "",
      "Devolutiva": c.devolutiva || "",
      "Status Financeiro": c.status_financeiro || "",
      "Cashback": c.cashback || "",
      "Nível Licenciado": c.nivel_licenciado || "",
      // Licenciado
      "Licenciado": c.registered_by_name || "",
      "Código Licenciado": c.registered_by_igreen_id || "",
      // Indicação
      "Indicado Por": c.customer_referred_by_name || "",
      "Telefone Indicador": c.customer_referred_by_phone || "",
      // Assinaturas
      "Assinatura Cliente": c.assinatura_cliente || "",
      "Assinatura iGreen": c.assinatura_igreen || "",
      "Link Assinatura": c.link_assinatura || "",
      // Datas
      "Data Cadastro": c.data_cadastro || c.created_at || "",
      "Data Ativo": c.data_ativo || "",
      "Data Validado": c.data_validado || "",
      // Status
      "Status": c.status || "",
      "Observação": c.observacao || "",
    }));
    const ws = XLSX.utils.json_to_sheet(exportData);
    // Auto-fit column widths
    const colWidths = Object.keys(exportData[0] || {}).map((key) => ({
      wch: Math.max(key.length, ...exportData.map((row) => String((row as any)[key] || "").length).slice(0, 50)) + 2,
    }));
    ws["!cols"] = colWidths;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Clientes");
    XLSX.writeFile(wb, `clientes-${new Date().toISOString().split("T")[0]}.xlsx`);
    toast({ title: "✅ Excel exportado!" });
  }

  const newCount = parsedCustomers.filter((p) => p.isNew).length;
  const existingCount = parsedCustomers.length - newCount;
  const selectedCount = selectedPhones.size;

  return (
    <>
      {/* Triggers — botões ou itens de menu */}
      {asMenuItems ? (
        <>
          <DropdownMenuItem onSelect={(e) => { e.preventDefault(); if (filtered.length > 0) handleExport(); }} disabled={filtered.length === 0}>
            <FileSpreadsheet className="w-4 h-4" /> Exportar Excel
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={(e) => { e.preventDefault(); fileInputRef.current?.click(); }} disabled={importing || parsing}>
            {(importing || parsing) ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            Importar Excel
          </DropdownMenuItem>
        </>
      ) : (
        <>
          <Button onClick={handleExport} size="sm" variant="outline" className="gap-2 rounded-xl font-semibold h-9 px-4 border-accent/20 text-accent-foreground hover:bg-accent/10" disabled={filtered.length === 0}>
            <FileSpreadsheet className="w-4 h-4" />
            Exportar
          </Button>
          <Button onClick={() => fileInputRef.current?.click()} size="sm" variant="outline" className="gap-2 rounded-xl font-semibold h-9 px-4 border-primary/20 text-primary hover:bg-primary/10" disabled={importing || parsing}>
            {(importing || parsing) ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            Importar Excel
          </Button>
        </>
      )}
      <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) handleFileSelected(file); }} />

      {/* Import Progress (rendered via portal-like pattern — parent places these) */}
      {importing && (
        <div className="absolute left-0 right-0 px-5 py-3 border-b border-border/50" style={{ top: "var(--import-progress-top, 0)" }}>
          <div className="flex items-center gap-3 mb-2">
            <FileSpreadsheet className="w-4 h-4 text-primary animate-pulse" />
            <span className="text-xs font-medium text-foreground">Importando... {importProgress.current}/{importProgress.total}</span>
          </div>
          <div className="w-full h-2 bg-secondary/50 rounded-full overflow-hidden">
            <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${importProgress.total > 0 ? (importProgress.current / importProgress.total) * 100 : 0}%` }} />
          </div>
          <div className="flex gap-4 mt-1.5 text-[10px] text-muted-foreground">
            <span className="text-primary">{importProgress.newCount} novos</span>
            {importProgress.errorCount > 0 && <span className="text-destructive">{importProgress.errorCount} erros</span>}
          </div>
        </div>
      )}

      {showImportResult && !importing && (
        <div className="absolute left-0 right-0 px-5 py-3 border-b border-border/50 bg-primary/5" style={{ top: "var(--import-result-top, 0)" }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-primary" />
              <span className="text-xs font-medium text-foreground">
                Importação concluída: {importProgress.newCount} novos, {importProgress.updatedCount} atualizados
                {importProgress.errorCount > 0 && `, ${importProgress.errorCount} erros`}
              </span>
            </div>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setShowImportResult(false)}>
              <X className="w-3 h-3" />
            </Button>
          </div>
        </div>
      )}

      {/* Import Preview Dialog */}
      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent className="max-w-2xl max-h-[85vh] p-0 overflow-hidden">
          <div className="bg-gradient-to-r from-primary/10 via-primary/5 to-transparent px-6 pt-6 pb-4 border-b border-border">
            <DialogHeader>
              <DialogTitle className="text-base font-bold flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-primary" />
                Aprovar Importação
              </DialogTitle>
            </DialogHeader>
            <div className="flex gap-4 mt-3 text-xs">
              <span className="text-muted-foreground">Total na planilha: <strong className="text-foreground">{parsedCustomers.length}</strong></span>
              <span className="text-primary">Novos: <strong>{newCount}</strong></span>
              <span className="text-muted-foreground">Já cadastrados: <strong>{existingCount}</strong> (ignorados)</span>
              <span className="text-primary">Selecionados: <strong>{selectedCount}</strong></span>
            </div>
          </div>

          <div className="px-6 py-2 border-b border-border/50 flex items-center justify-between">
            <button onClick={toggleSelectAll} className="flex items-center gap-2 text-xs font-medium text-foreground hover:text-primary transition-colors">
              <Checkbox checked={parsedCustomers.length > 0 && selectedPhones.size === parsedCustomers.length} onCheckedChange={toggleSelectAll} />
              Selecionar todos ({parsedCustomers.length})
            </button>
          </div>

          <ScrollArea className="max-h-[55vh]">
            <div className="px-6 py-2 space-y-1">
              {parsedCustomers.map((p) => {
                const isSelected = selectedPhones.has(p.phone);
                const statusBadge = getStatusBadge(p.status);
                return (
                  <div key={p.phone} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all ${isSelected ? "border-primary/30 bg-primary/[0.04]" : "border-border/30 bg-secondary/5 hover:bg-secondary/15"}`}>
                    <Checkbox checked={isSelected} onCheckedChange={() => toggleSelect(p.phone)} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-foreground truncate">{p.name || "Sem nome"}</p>
                        <Badge variant="outline" className={`text-[9px] px-1.5 py-0 h-4 ${statusBadge.className}`}>{statusBadge.label}</Badge>
                        {!p.isNew && <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 bg-warning/10 text-warning border-warning/20">Atualizar</Badge>}
                        {p.isNew && <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 bg-primary/10 text-primary border-primary/20">Novo</Badge>}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                          <Phone className="h-2.5 w-2.5" />{formatPhoneDisplay(p.phone)}
                        </span>
                        {p.data.address_city && (
                          <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                            <MapPin className="h-2.5 w-2.5" />{String(p.data.address_city)}{p.data.address_state ? `/${p.data.address_state}` : ""}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>

          <div className="px-6 py-4 border-t border-border flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              <strong className="text-primary">Novos</strong> serão criados, <strong className="text-warning">existentes</strong> serão atualizados com dados do Excel.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="h-9 text-xs px-4" onClick={() => setShowPreview(false)}>Cancelar</Button>
              <Button size="sm" className="h-9 text-xs px-5 gap-1.5 font-semibold shadow-lg shadow-primary/20" onClick={handleConfirmImport} disabled={selectedCount === 0}>
                <Upload className="w-3.5 h-3.5" />
                Importar {selectedCount} cliente{selectedCount !== 1 ? "s" : ""}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
