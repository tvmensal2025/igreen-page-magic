// =============================================================================
// Orçamento — Seletor de destinatário
// =============================================================================
// O orçamento pode ir para um cliente da base do consultor (busca por nome/
// telefone) OU para um contato avulso (nome + número digitados). Conforme o
// pedido: "pode ser enviado para o cliente ou para quem ele quiser".
// =============================================================================

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Users, UserPlus } from "lucide-react";
import { normalizeBrazilPhone } from "@/services/messageSender";

function normalizeRecipientPhone(raw: string): string | null {
  return normalizeBrazilPhone(raw) || (raw.replace(/\D/g, "").length >= 10 ? raw.replace(/\D/g, "") : null);
}

export interface RecipientSelection {
  /** Cliente da base (quando escolhido da lista). */
  customerId?: string | null;
  name: string;
  phone: string;
}

interface CustomerRow {
  id: string;
  name: string | null;
  phone_whatsapp: string;
}

interface RecipientPickerProps {
  consultantId: string;
  value: RecipientSelection | null;
  onChange: (value: RecipientSelection | null) => void;
}

export function RecipientPicker({ consultantId, value, onChange }: RecipientPickerProps) {
  const [tab, setTab] = useState<"base" | "avulso">("base");
  const [search, setSearch] = useState("");
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [loading, setLoading] = useState(false);

  // Avulso
  const [avulsoName, setAvulsoName] = useState("");
  const [avulsoPhone, setAvulsoPhone] = useState("");

  useEffect(() => {
    if (tab !== "base" || !consultantId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data } = await supabase
        .from("customers")
        .select("id, name, phone_whatsapp")
        .eq("consultant_id", consultantId)
        .order("name", { ascending: true })
        .limit(500);
      if (!cancelled) {
        setCustomers((data as CustomerRow[]) || []);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, consultantId]);

  const filtered = customers.filter((c) => {
    const q = search.toLowerCase();
    return (c.name || "").toLowerCase().includes(q) || c.phone_whatsapp.includes(q);
  });

  const syncAvulso = (name: string, phone: string) => {
    setAvulsoName(name);
    setAvulsoPhone(phone);
    const digits = normalizeRecipientPhone(phone);
    if (name.trim() && digits) {
      onChange({ customerId: null, name: name.trim(), phone: digits });
    } else {
      onChange(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5">
        <Button
          type="button"
          variant={tab === "base" ? "default" : "outline"}
          size="sm"
          className="h-8 text-xs gap-1 flex-1"
          onClick={() => setTab("base")}
        >
          <Users className="h-3.5 w-3.5" />
          Da minha base
        </Button>
        <Button
          type="button"
          variant={tab === "avulso" ? "default" : "outline"}
          size="sm"
          className="h-8 text-xs gap-1 flex-1"
          onClick={() => setTab("avulso")}
        >
          <UserPlus className="h-3.5 w-3.5" />
          Outro número
        </Button>
      </div>

      {tab === "base" ? (
        <>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome ou telefone..."
              className="h-8 text-xs pl-8"
            />
          </div>
          <div className="max-h-[220px] overflow-y-auto border rounded-md">
            {loading && (
              <p className="text-[11px] text-muted-foreground text-center py-4">Carregando...</p>
            )}
            {!loading && filtered.length === 0 && (
              <p className="text-[11px] text-muted-foreground text-center py-4">
                Nenhum cliente encontrado
              </p>
            )}
            <div className="p-1 space-y-0.5">
              {filtered.map((c) => {
                const selected = value?.customerId === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      const digits = normalizeRecipientPhone(c.phone_whatsapp);
                      if (!digits) return;
                      onChange({
                        customerId: c.id,
                        name: c.name || c.phone_whatsapp,
                        phone: digits,
                      });
                    }}
                    className={`w-full text-left flex items-center gap-2 p-1.5 rounded transition-colors ${
                      selected ? "bg-primary/15" : "hover:bg-secondary/50"
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{c.name || "Sem nome"}</p>
                      <p className="text-[10px] text-muted-foreground">{c.phone_whatsapp}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      ) : (
        <div className="space-y-2">
          <div>
            <label className="text-[10px] text-muted-foreground font-medium">Nome *</label>
            <Input
              value={avulsoName}
              onChange={(e) => syncAvulso(e.target.value, avulsoPhone)}
              placeholder="Nome de quem vai receber"
              className="h-8 text-xs mt-1"
            />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground font-medium">WhatsApp *</label>
            <Input
              value={avulsoPhone}
              onChange={(e) => syncAvulso(avulsoName, e.target.value)}
              placeholder="11999998888"
              className="h-8 text-xs mt-1"
            />
          </div>
        </div>
      )}
    </div>
  );
}
