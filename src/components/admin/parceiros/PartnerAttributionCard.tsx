import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { QrCode, Tag, ArrowRight, Users } from "lucide-react";
import type { PartnerAnalytics } from "./hooks/usePartnerAnalytics";

interface Props {
  analytics: PartnerAnalytics[];
}

/**
 * Card explicativo: mostra como os clientes são atribuídos aos parceiros
 * (QR Code ou palavra-chave no WhatsApp) e o total acumulado por origem.
 * Puramente apresentacional — usa os mesmos dados de usePartnerAnalytics.
 */
export function PartnerAttributionCard({ analytics }: Props) {
  const qrTotal = analytics.reduce((s, p) => s + p.qr_count, 0);
  const keywordTotal = analytics.reduce((s, p) => s + p.keyword_count, 0);
  const total = qrTotal + keywordTotal;
  const qrPct = total > 0 ? Math.round((qrTotal / total) * 100) : 0;
  const keywordPct = total > 0 ? 100 - qrPct : 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          Como seus parceiros recebem clientes
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Dois caminhos de atribuição */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-primary/20 bg-gradient-to-br from-primary/[0.06] to-transparent p-3">
            <div className="flex items-center gap-2 mb-1.5">
              <div className="h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center ring-1 ring-primary/20">
                <QrCode className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold leading-tight">QR Code</div>
                <div className="text-[10px] text-muted-foreground">Flyer, banner, story</div>
              </div>
              <div className="ml-auto text-right">
                <div className="text-xl font-bold tabular-nums leading-none">{qrTotal}</div>
                <div className="text-[9px] uppercase text-muted-foreground mt-0.5">{qrPct}%</div>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground leading-snug">
              O cliente escaneia o QR do parceiro e abre o WhatsApp já com a frase pronta.
            </p>
          </div>

          <div className="rounded-xl border border-accent/20 bg-gradient-to-br from-accent/[0.06] to-transparent p-3">
            <div className="flex items-center gap-2 mb-1.5">
              <div className="h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center ring-1 ring-primary/20">
                <Tag className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold leading-tight">Palavra-chave</div>
                <div className="text-[10px] text-muted-foreground">Texto no WhatsApp</div>
              </div>
              <div className="ml-auto text-right">
                <div className="text-xl font-bold tabular-nums leading-none">{keywordTotal}</div>
                <div className="text-[9px] uppercase text-muted-foreground mt-0.5">{keywordPct}%</div>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground leading-snug">
              O cliente menciona a palavra-chave do parceiro e o sistema atribui automaticamente.
            </p>
          </div>
        </div>

        {/* Barra de proporção */}
        {total > 0 && (
          <div>
            <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
              <div className="bg-primary" style={{ width: `${qrPct}%` }} />
              <div className="bg-accent" style={{ width: `${keywordPct}%` }} />
            </div>
            <div className="flex justify-between text-[10px] text-muted-foreground mt-1.5">
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-primary" /> QR Code
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-accent" /> Palavra-chave
              </span>
            </div>
          </div>
        )}

        {/* Fluxo */}
        <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">Cliente</span>
          <ArrowRight className="h-3 w-3 shrink-0" />
          <span>QR ou palavra-chave</span>
          <ArrowRight className="h-3 w-3 shrink-0" />
          <span>Atribuído ao parceiro</span>
          <ArrowRight className="h-3 w-3 shrink-0" />
          <span className="font-medium text-foreground">Funil</span>
        </div>
      </CardContent>
    </Card>
  );
}
