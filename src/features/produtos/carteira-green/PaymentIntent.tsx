import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import type { BoletoRow } from "./hooks";
import { scoreIntent, INTENT_LABEL, INTENT_STYLE, INTENT_ACTION, type IntentLevel } from "./intent";

const BRL = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function PaymentIntent({ boletos }: { boletos: BoletoRow[] }) {
  const historyByCliente = useMemo(() => {
    const map = new Map<number | string, BoletoRow[]>();
    for (const b of boletos) {
      const k = b.idcliente ?? b.id;
      const arr = map.get(k) || [];
      arr.push(b);
      map.set(k, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => (b.vencimento || "").localeCompare(a.vencimento || ""));
    }
    return map;
  }, [boletos]);

  const emAberto = useMemo(() => {
    return boletos
      .filter((b) => !b.pagamento && !String(b.status || "").toLowerCase().includes("pago"))
      .map((b) => ({
        b,
        intent: scoreIntent(b, historyByCliente.get(b.idcliente ?? b.id) || []),
      }));
  }, [boletos, historyByCliente]);

  const buckets: Record<IntentLevel, typeof emAberto> = { alta: [], media: [], baixa: [], perdido: [] };
  for (const item of emAberto) buckets[item.intent].push(item);

  const order: IntentLevel[] = ["alta", "media", "baixa", "perdido"];

  return (
    <section className="rounded-xl border border-border/60 bg-card">
      <header className="p-4 border-b border-border/60">
        <h3 className="text-sm font-semibold">Quem vai pagar</h3>
        <p className="text-[11px] text-muted-foreground">
          Score determinístico baseado no histórico. Use para priorizar contato.
        </p>
      </header>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 p-4">
        {order.map((lvl) => (
          <div key={lvl} className="rounded-lg border border-border/40 p-3 bg-background">
            <div className="flex items-center justify-between mb-2">
              <Badge variant="outline" className={`text-[10px] ${INTENT_STYLE[lvl]}`}>
                {INTENT_LABEL[lvl]}
              </Badge>
              <span className="text-lg font-bold">{buckets[lvl].length}</span>
            </div>
            <p className="text-[10px] text-muted-foreground mb-2">{INTENT_ACTION[lvl]}</p>
            <ul className="space-y-1 max-h-40 overflow-y-auto">
              {buckets[lvl].slice(0, 8).map(({ b }) => (
                <li key={b.id} className="text-[11px] flex items-center justify-between gap-2">
                  <span className="truncate">{b.nome || b.customer_name || "Cliente"}</span>
                  <span className="shrink-0 text-muted-foreground">{BRL(Number(b.total || 0))}</span>
                </li>
              ))}
              {buckets[lvl].length > 8 && (
                <li className="text-[10px] text-muted-foreground">+{buckets[lvl].length - 8}</li>
              )}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
