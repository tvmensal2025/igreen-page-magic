import { useState } from "react";
import { Search, Send, User, MessageSquare, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { sendTextMessage } from "@/services/evolutionApi";
import type { MessageTemplate } from "@/types/whatsapp";

interface Customer { id: string; name: string; phone_whatsapp: string; electricity_bill_value?: number; }
interface MessagePanelProps {
  instanceName: string;
  customers: Customer[];
  templates: MessageTemplate[];
  applyTemplate: (t: MessageTemplate, c: { name: string; electricity_bill_value?: number }) => string;
}

export function filterCustomers<T extends { name: string; phone_whatsapp: string }>(customers: T[], search: string): T[] {
  if (!search.trim()) return customers;
  const lower = search.toLowerCase();
  return customers.filter((c) => c.name.toLowerCase().includes(lower) || c.phone_whatsapp.toLowerCase().includes(lower));
}

export function MessagePanel({ instanceName, customers, templates, applyTemplate }: MessagePanelProps) {
  const [search, setSearch] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [message, setMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const { toast } = useToast();
  const filtered = filterCustomers(customers, search);

  function handleSelectCustomer(customer: Customer) { setSelectedCustomer(customer); setMessage(""); }
  function handleTemplateChange(templateId: string) {
    if (!selectedCustomer) return;
    const t = templates.find((t) => t.id === templateId);
    if (t) setMessage(applyTemplate(t, selectedCustomer));
  }
  async function handleSend() {
    if (!selectedCustomer || !message.trim()) return;
    setIsSending(true);
    try {
      await sendTextMessage(instanceName, selectedCustomer.phone_whatsapp, message);
      toast({ title: "✅ Mensagem enviada", description: `Enviada para ${selectedCustomer.name}` });
      setMessage("");
    } catch (err) {
      toast({ title: "Erro ao enviar", description: err instanceof Error ? err.message : "Erro desconhecido", variant: "destructive" });
    } finally { setIsSending(false); }
  }

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-card via-card to-info/10">
      <div className="absolute -top-20 -right-20 w-40 h-40 bg-info/3 rounded-full blur-3xl" />
      <div className="relative p-5 sm:p-7">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-info/20 to-info/10 flex items-center justify-center border border-info/20">
            <MessageSquare className="w-5 h-5 text-info" />
          </div>
          <div>
            <h3 className="font-heading font-bold text-foreground text-lg">Envio Individual</h3>
            <p className="text-xs text-muted-foreground">Mensagem personalizada para um cliente</p>
          </div>
        </div>

        {/* Search */}
        <div className="relative mb-4">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60" />
          <Input placeholder="Buscar por nome ou telefone..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10 rounded-xl bg-secondary/50 border-border/50 focus:border-info/40 focus:ring-info/10 transition-all" />
        </div>

        {/* Customer list */}
        <div className="max-h-52 overflow-y-auto rounded-xl border border-border/50 mb-4 divide-y divide-border/30">
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">Nenhum cliente encontrado</p>
          ) : filtered.map((customer) => (
            <button key={customer.id} type="button" onClick={() => handleSelectCustomer(customer)}
              className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-all hover:bg-secondary/40 ${selectedCustomer?.id === customer.id ? "bg-info/8 border-l-2 border-l-blue-400" : ""}`}>
              <div className="w-8 h-8 rounded-lg bg-secondary/80 flex items-center justify-center shrink-0">
                <User className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <p className="text-sm text-foreground font-medium truncate">{customer.name}</p>
                <p className="text-xs text-muted-foreground/70">{customer.phone_whatsapp}</p>
              </div>
            </button>
          ))}
        </div>

        {/* Composition */}
        {selectedCustomer && (
          <div className="space-y-3 rounded-xl border border-border/40 bg-secondary/20 p-4">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-info/15 flex items-center justify-center">
                <User className="w-4 h-4 text-info" />
              </div>
              <div>
                <span className="text-sm font-bold text-foreground">{selectedCustomer.name}</span>
                <p className="text-xs text-muted-foreground">{selectedCustomer.phone_whatsapp}</p>
              </div>
            </div>
            {templates.length > 0 && (
              <Select onValueChange={handleTemplateChange}>
                <SelectTrigger className="rounded-xl bg-secondary/50 border-border/50">
                  <Sparkles className="w-3.5 h-3.5 text-primary mr-2" />
                  <SelectValue placeholder="Usar template..." />
                </SelectTrigger>
                <SelectContent>{templates.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
              </Select>
            )}
            <Textarea placeholder="Digite sua mensagem..." value={message} onChange={(e) => setMessage(e.target.value)} rows={4} className="rounded-xl bg-secondary/30 border-border/40 focus:border-info/40 resize-none" />
            <Button onClick={handleSend} disabled={!message.trim() || isSending} className="gap-2 rounded-xl h-11 font-bold shadow-lg shadow-green-500/10 hover:shadow-green-500/20 transition-all" style={{ background: "var(--gradient-green)" }}>
              <Send className="w-4 h-4" /> {isSending ? "Enviando..." : "Enviar Mensagem"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
