import { useState } from "react";
import {
  Trash2, Phone, Mail, MapPin, Zap, ChevronDown, Pencil,
  CreditCard, User, MessageCircle, Building2, AlertTriangle, FileText, ClipboardCopy, Users,
  Download, FileDown, Loader2, ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  type Customer, formatPhoneDisplay, formatCpfDisplay, getInitials,
  getStatusBadge, getStageDotsForCustomer, isDevolutiva,
} from "./customerUtils";

/* ── Linha de detalhe (label em cima, valor embaixo) ── */
function DetailItem({ icon: Icon, label, value, sensitiveClass }: { icon: React.ElementType; label: string; value: string; sensitiveClass?: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <div className="mt-0.5 h-7 w-7 rounded-lg bg-secondary/60 flex items-center justify-center shrink-0">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] text-muted-foreground uppercase tracking-wide leading-tight">{label}</p>
        <p className={`text-sm text-foreground font-medium break-words ${sensitiveClass || ""}`}>{value}</p>
      </div>
    </div>
  );
}

/* ── Barra de progresso de estágios (legível, substitui as bolinhas) ── */
function StageTracker({ stageDots }: { stageDots: ReturnType<typeof getStageDotsForCustomer> }) {
  if (!stageDots.length) return null;
  return (
    <div className="flex items-center gap-1.5">
      {stageDots.map((dot) => (
        <div key={dot.key} className="flex flex-col items-center gap-1" title={`${dot.label}: ${dot.reached ? "concluído" : "pendente"}`}>
          <div className={`h-1.5 w-7 sm:w-10 rounded-full transition-all ${dot.reached ? dot.color : "bg-muted/40"}`} />
          <span className={`text-[9px] leading-none ${dot.reached ? "text-foreground/70" : "text-muted-foreground/50"}`}>{dot.label}</span>
        </div>
      ))}
    </div>
  );
}

function DocumentDownloadSection({ customerId }: { customerId: string }) {
  const [loading, setLoading] = useState(false);
  const [docs, setDocs] = useState<Array<{ type: string; url: string }> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFetchDocs = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke("upload-documents-minio", {
        body: { customer_id: customerId },
      });
      if (fnError) throw fnError;
      if (data?.uploads?.length > 0) {
        setDocs(data.uploads.filter((u: { success: boolean }) => u.success));
      } else {
        setError("Nenhum documento encontrado");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao buscar documentos");
    } finally {
      setLoading(false);
    }
  };

  const docLabel: Record<string, string> = {
    conta: "Conta de Energia",
    doc_frente: "Documento (frente)",
    doc_verso: "Documento (verso)",
  };

  return (
    <div>
      {!docs && !error && (
        <Button variant="outline" size="sm" className="h-9 gap-2 rounded-lg" onClick={handleFetchDocs} disabled={loading}>
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
          {loading ? "Preparando documentos..." : "Baixar documentos"}
        </Button>
      )}
      {error && <p className="text-sm text-muted-foreground">{error}</p>}
      {docs && docs.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {docs.map((doc) => (
            <a key={doc.type} href={doc.url} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="sm" className="h-9 gap-2 rounded-lg text-primary border-primary/30 hover:bg-primary/10">
                <Download className="w-4 h-4" /> {docLabel[doc.type] || doc.type}
              </Button>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

interface CustomerListItemProps {
  customer: Customer;
  isExpanded: boolean;
  profilePic?: string;
  deal?: { stage: string; deal_origin?: string | null };
  onToggleExpand: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onOpenWhatsApp: () => void;
  onCopyMessage: () => void;
}

export function CustomerListItem({
  customer: c, isExpanded, profilePic, deal,
  onToggleExpand, onEdit, onDelete, onOpenWhatsApp, onCopyMessage,
}: CustomerListItemProps) {
  const status = getStatusBadge(c.status);
  const hasDevolutiva = isDevolutiva(c);
  const stageDots = getStageDotsForCustomer(c.status, deal);

  // Resumo de localização e contato para a linha principal
  const location = [c.address_city, c.address_state].filter(Boolean).join(" / ");

  return (
    <div
      className={`rounded-2xl border transition-all duration-200 overflow-hidden ${
        isExpanded
          ? "border-primary/30 bg-card shadow-lg shadow-primary/5"
          : hasDevolutiva
          ? "border-destructive/25 bg-card hover:border-destructive/40"
          : "border-border bg-card hover:border-primary/25 hover:shadow-md"
      }`}
    >
      {/* ─── Linha principal (sempre visível) ─── */}
      <button
        type="button"
        className="w-full flex items-center gap-4 p-4 text-left"
        onClick={onToggleExpand}
        aria-expanded={isExpanded}
      >
        {/* Avatar */}
        <Avatar className="h-12 w-12 shrink-0 border border-border">
          <AvatarImage src={profilePic} />
          <AvatarFallback className="bg-gradient-to-br from-primary/20 to-primary/5 text-sm font-bold text-primary">
            {getInitials(c.name)}
          </AvatarFallback>
        </Avatar>

        {/* Nome + badges + contato resumido */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-base font-bold text-foreground truncate sensitive-name max-w-[260px]">
              {c.name || "Sem nome"}
            </span>
            <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${status.className}`}>
              {status.label}
            </span>
            {c.tipo_produto === "telefonia" && (
              <span className="text-xs px-2 py-0.5 rounded-full border font-medium bg-primary/15 text-primary border-primary/25">
                📱 Telecom
              </span>
            )}
            {hasDevolutiva && status.label !== "Devolutiva" && (
              <span className="text-xs px-2 py-0.5 rounded-full border font-medium bg-destructive/15 text-destructive border-destructive/25">
                ⚠️ Devolutiva
              </span>
            )}
          </div>
          <div className="flex items-center gap-x-4 gap-y-1 mt-1.5 flex-wrap text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <Phone className="h-3.5 w-3.5 shrink-0" />
              <span className="sensitive-phone">{formatPhoneDisplay(c.phone_whatsapp)}</span>
            </span>
            {c.distribuidora && (
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap max-w-[180px] truncate">
                <Building2 className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{c.distribuidora}</span>
              </span>
            )}
            {location && (
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <MapPin className="h-3.5 w-3.5 shrink-0" />
                {location}
              </span>
            )}
          </div>
        </div>

        {/* Stage tracker (desktop) + valor + chevron */}
        <div className="hidden lg:block shrink-0">
          <StageTracker stageDots={stageDots} />
        </div>
        {c.electricity_bill_value != null && c.electricity_bill_value > 0 && (
          <div className="text-right shrink-0 hidden sm:block">
            <p className="text-base font-bold text-primary tabular-nums">
              R$ {c.electricity_bill_value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
            </p>
            <p className="text-[11px] text-muted-foreground">conta de luz</p>
          </div>
        )}
        <ChevronDown className={`h-5 w-5 text-muted-foreground shrink-0 transition-transform duration-300 ${isExpanded ? "rotate-180" : ""}`} />
      </button>

      {/* Stage tracker no mobile (linha separada) */}
      <div className="lg:hidden px-4 pb-3 -mt-1">
        <StageTracker stageDots={stageDots} />
      </div>

      {/* ─── Conteúdo expandido ─── */}
      {isExpanded && (
        <div className="border-t border-border bg-secondary/20 p-5 space-y-5">
          {/* Devolutiva / Observação em destaque no topo */}
          {(c.devolutiva || c.observacao) && (
            <div className="space-y-2.5">
              {c.devolutiva && (
                <div className="rounded-xl border border-destructive/25 bg-destructive/10 px-4 py-3">
                  <div className="flex items-center gap-2 mb-1">
                    <AlertTriangle className="h-4 w-4 text-destructive" />
                    <span className="text-xs font-bold text-destructive uppercase tracking-wide">Devolutiva</span>
                  </div>
                  <p className="text-sm text-foreground">{c.devolutiva}</p>
                </div>
              )}
              {c.observacao && (
                <div className="rounded-xl border border-border bg-card px-4 py-3">
                  <div className="flex items-center gap-2 mb-1">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <span className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Observação</span>
                  </div>
                  <p className="text-sm text-foreground">{c.observacao}</p>
                </div>
              )}
            </div>
          )}

          {/* Grupos de informação */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
            {c.cpf && <DetailItem icon={CreditCard} label="CPF" value={formatCpfDisplay(c.cpf)} sensitiveClass="sensitive-cpf" />}
            {c.email && <DetailItem icon={Mail} label="E-mail" value={c.email} sensitiveClass="sensitive-email" />}
            <DetailItem icon={Phone} label="WhatsApp" value={formatPhoneDisplay(c.phone_whatsapp)} sensitiveClass="sensitive-phone" />
            {c.data_nascimento && <DetailItem icon={User} label="Nascimento" value={c.data_nascimento} sensitiveClass="sensitive-data" />}
            {c.distribuidora && <DetailItem icon={Building2} label="Distribuidora" value={c.distribuidora} />}
            {c.media_consumo != null && <DetailItem icon={Zap} label="Consumo médio" value={`${c.media_consumo} kWh`} />}
            {c.desconto_cliente != null && <DetailItem icon={Zap} label="Desconto" value={`${c.desconto_cliente}%`} />}
            {c.electricity_bill_value != null && c.electricity_bill_value > 0 && (
              <DetailItem icon={CreditCard} label="Valor da conta" value={`R$ ${c.electricity_bill_value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`} />
            )}
            {(c.address_street || location) && (
              <DetailItem
                icon={MapPin}
                label="Endereço"
                value={[c.address_street, c.address_number, location].filter(Boolean).join(", ")}
              />
            )}
            {c.numero_instalacao && <DetailItem icon={Zap} label="Nº instalação" value={c.numero_instalacao} />}
            {c.igreen_code && <DetailItem icon={FileText} label="Código iGreen" value={c.igreen_code} />}
            {c.andamento_igreen && <DetailItem icon={FileText} label="Andamento iGreen" value={c.andamento_igreen} />}
            {c.status_financeiro && <DetailItem icon={CreditCard} label="Status financeiro" value={c.status_financeiro} />}
            {c.cashback && <DetailItem icon={CreditCard} label="Cashback" value={c.cashback} />}
            {c.registered_by_name && (
              <DetailItem icon={User} label="Licenciado" value={`${c.registered_by_name}${c.registered_by_igreen_id ? ` (${c.registered_by_igreen_id})` : ""}`} />
            )}
            {c.customer_referred_by_name && (
              <DetailItem icon={Users} label="Indicado por" value={c.customer_referred_by_name} sensitiveClass="sensitive-name" />
            )}
            {c.created_at && <DetailItem icon={FileText} label="Cadastrado no sistema" value={new Date(c.created_at).toLocaleDateString("pt-BR")} />}
          </div>

          {c.link_assinatura && (
            <a href={c.link_assinatura} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm text-primary hover:underline font-medium">
              <ExternalLink className="h-4 w-4" /> Abrir link de assinatura
            </a>
          )}

          {/* Documentos */}
          <div className="pt-1">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">Documentos</p>
            <DocumentDownloadSection customerId={c.id} />
          </div>

          {/* Ações */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-4 border-t border-border">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" className="h-9 gap-2 rounded-lg bg-primary hover:bg-primary text-white" onClick={onOpenWhatsApp}>
                <MessageCircle className="w-4 h-4" /> Enviar WhatsApp
              </Button>
              <Button variant="outline" size="sm" className="h-9 gap-2 rounded-lg" onClick={onCopyMessage}>
                <ClipboardCopy className="w-4 h-4" /> Copiar mensagem
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" className="h-9 gap-2 rounded-lg text-primary border-primary/30 hover:bg-primary/10" onClick={onEdit}>
                <Pencil className="w-4 h-4" /> Editar
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" className="h-9 gap-2 rounded-lg text-destructive border-destructive/30 hover:bg-destructive/10">
                    <Trash2 className="w-4 h-4" /> Remover
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Remover cliente</AlertDialogTitle>
                    <AlertDialogDescription>Tem certeza que deseja remover {c.name || "este cliente"}?</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={onDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Remover</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
