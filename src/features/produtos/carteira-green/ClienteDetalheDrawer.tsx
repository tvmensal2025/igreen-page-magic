// =============================================================================
// Drawer lateral (Sheet) com o detalhe de UM cliente da carteira iGreen.
// Recebe os boletos e devolutivas já filtrados por cliente pelo pai.
// Mostra: cabeçalho + abas (Boletos · Devolutivas · Intenção · Telecom/Seguros).
// =============================================================================

import { useMemo } from "react";
import { ExternalLink, MessageCircle, AlertTriangle, CheckCircle2, Wallet, FileText, Activity, PhoneCall, ShieldCheck } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { BoletoRow, DevolutivaRow } from "./hooks";
import { scoreIntent, INTENT_LABEL, INTENT_STYLE, INTENT_ACTION } from "./intent";

const BRL = (n: number | null | undefined) =>
  Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export interface ClienteAggregate {
  key: string;
  idcliente: number | null;
  nome: string;
  cidade: string | null;
  uf: string | null;
  fornecedora: string | null;
  phone: string | null;
  boletos: BoletoRow[];
  devolutivas: DevolutivaRow[];
  telecom: TelecomRow[];
  seguros: SeguroRow[];
}

export interface TelecomRow {
  id: string;
  nome: string | null;
  numero: string | null;
  status_label: string | null;
  fatura_valor: number | null;
  fatura_status: string | null;
  fatura_mes_referencia: string | null;
}

export interface SeguroRow {
  id: string;
  segurado: string | null;
  modelo: string | null;
  placa: string | null;
  mensal: number | null;
  status_label: string | null;
}

export function ClienteDetalheDrawer({
  cliente,
  open,
  onOpenChange,
}: {
  cliente: ClienteAggregate | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const c = cliente;

  const totals = useMemo(() => {
    if (!c) return { abertos: 0, valorAberto: 0, kwh: 0, injecao: false, ultimoIntent: null as ReturnType<typeof scoreIntent> | null };
    const abertos = c.boletos.filter((b) => !b.pagamento && !String(b.status || "").toLowerCase().includes("pago"));
    const valorAberto = abertos.reduce((s, b) => s + Number(b.total || 0), 0);
    const kwh = c.boletos.reduce((s, b) => s + Number(b.kwh_compensado || 0), 0);
    const injecao = c.boletos.some((b) => !!b.injecao);
    const last = c.boletos[0];
    const ultimoIntent = last && !last.pagamento ? scoreIntent(last, c.boletos) : null;
    return { abertos: abertos.length, valorAberto, kwh, injecao, ultimoIntent };
  }, [c]);

  if (!c) return null;

  const waLink = c.phone
    ? `https://wa.me/${c.phone.replace(/\D/g, "")}`
    : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto p-0">
        <SheetHeader className="px-5 pt-5 pb-3 border-b border-border/60">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <SheetTitle className="text-base font-semibold truncate">{c.nome}</SheetTitle>
              <p className="text-[12px] text-muted-foreground mt-0.5 truncate">
                {c.cidade || "?"}/{c.uf || "?"} · {c.fornecedora || "—"}
                {c.phone ? <> · {c.phone}</> : null}
              </p>
            </div>
            {waLink && (
              <a href={waLink} target="_blank" rel="noreferrer">
                <Button size="sm" className="h-8 text-xs">
                  <MessageCircle className="h-3.5 w-3.5 mr-1.5" /> WhatsApp
                </Button>
              </a>
            )}
          </div>

          {/* Mini KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
            <MiniKpi icon={FileText} label="Boletos abertos" value={String(totals.abertos)} />
            <MiniKpi icon={Wallet} label="Em aberto" value={BRL(totals.valorAberto)} />
            <MiniKpi icon={Activity} label="Injeção" value={totals.injecao ? "Ativa" : "—"} />
            <MiniKpi icon={FileText} label="Devolutivas" value={String(c.devolutivas.length)} />
          </div>

          {totals.ultimoIntent && (
            <div className="mt-2 flex items-center gap-2 text-[11px]">
              <Badge variant="outline" className={INTENT_STYLE[totals.ultimoIntent]}>
                {INTENT_LABEL[totals.ultimoIntent]}
              </Badge>
              <span className="text-muted-foreground italic">
                {INTENT_ACTION[totals.ultimoIntent]}
              </span>
            </div>
          )}
        </SheetHeader>

        <Tabs defaultValue="boletos" className="px-5 py-4">
          <TabsList className="w-full justify-start">
            <TabsTrigger value="boletos" className="text-xs">Boletos ({c.boletos.length})</TabsTrigger>
            <TabsTrigger value="devolutivas" className="text-xs">Devolutivas ({c.devolutivas.length})</TabsTrigger>
            {c.telecom.length > 0 && <TabsTrigger value="telecom" className="text-xs">Telecom ({c.telecom.length})</TabsTrigger>}
            {c.seguros.length > 0 && <TabsTrigger value="seguros" className="text-xs">Seguros ({c.seguros.length})</TabsTrigger>}
          </TabsList>

          <TabsContent value="boletos" className="mt-4">
            {c.boletos.length === 0 ? (
              <Empty>Sem boletos.</Empty>
            ) : (
              <ul className="space-y-2">
                {c.boletos.map((b) => {
                  const pago = !!b.pagamento;
                  const vencido = (b.dias_atraso ?? 0) > 0;
                  return (
                    <li key={b.id} className="rounded-lg border border-border/60 p-3 bg-background">
                      <div className="flex items-start justify-between gap-2 flex-wrap">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium">{b.mes_referencia || "—"}</span>
                            {pago ? (
                              <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30 text-[10px]" variant="outline">Pago</Badge>
                            ) : vencido ? (
                              <Badge className="bg-red-500/10 text-red-600 border-red-500/30 text-[10px]" variant="outline">
                                Vencido · {b.dias_atraso}d
                              </Badge>
                            ) : (
                              <Badge className="bg-blue-500/10 text-blue-600 border-blue-500/30 text-[10px]" variant="outline">A vencer</Badge>
                            )}
                          </div>
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            Vence {b.vencimento ? new Date(b.vencimento).toLocaleDateString("pt-BR") : "—"}
                            {b.pagamento && <> · pago em {new Date(b.pagamento).toLocaleDateString("pt-BR")}</>}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-semibold">{BRL(Number(b.total || 0))}</p>
                          <div className="flex gap-1 mt-1 justify-end">
                            {b.url_boleto && (
                              <a href={b.url_boleto} target="_blank" rel="noreferrer">
                                <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]">
                                  <ExternalLink className="h-3 w-3 mr-1" /> Boleto
                                </Button>
                              </a>
                            )}
                            {b.url_invoice && (
                              <a href={b.url_invoice} target="_blank" rel="noreferrer">
                                <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]">
                                  <ExternalLink className="h-3 w-3 mr-1" /> NF
                                </Button>
                              </a>
                            )}
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </TabsContent>

          <TabsContent value="devolutivas" className="mt-4">
            {c.devolutivas.length === 0 ? (
              <Empty>Sem devolutivas.</Empty>
            ) : (
              <ul className="space-y-2">
                {c.devolutivas.map((d) => (
                  <li key={d.id} className="rounded-lg border border-border/60 p-3 bg-background">
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{d.categoria || "Sem categoria"}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {d.campo && <strong className="text-foreground">{d.campo}: </strong>}
                          {d.motivo || "—"}
                        </p>
                        {d.data_devolutiva && (
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {new Date(d.data_devolutiva).toLocaleDateString("pt-BR")}
                          </p>
                        )}
                      </div>
                      <div className="shrink-0">
                        {d.resolvida_em ? (
                          <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30 text-[10px]" variant="outline">
                            <CheckCircle2 className="h-3 w-3 mr-1" /> Resolvida
                          </Badge>
                        ) : d.impeditiva ? (
                          <Badge className="bg-red-500/10 text-red-600 border-red-500/30 text-[10px]" variant="outline">
                            <AlertTriangle className="h-3 w-3 mr-1" /> Impeditiva
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px]">Aberta</Badge>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>

          {c.telecom.length > 0 && (
            <TabsContent value="telecom" className="mt-4">
              <ul className="space-y-2">
                {c.telecom.map((t) => (
                  <li key={t.id} className="rounded-lg border border-border/60 p-3 bg-background flex items-start justify-between gap-2 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <PhoneCall className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-sm font-medium">Linha {t.numero || "—"}</span>
                        {t.status_label && <Badge variant="outline" className="text-[10px]">{t.status_label}</Badge>}
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {t.fatura_mes_referencia || ""}
                        {t.fatura_status ? ` · fatura ${t.fatura_status}` : ""}
                      </p>
                    </div>
                    <p className="text-sm font-semibold shrink-0">{BRL(t.fatura_valor)}</p>
                  </li>
                ))}
              </ul>
            </TabsContent>
          )}

          {c.seguros.length > 0 && (
            <TabsContent value="seguros" className="mt-4">
              <ul className="space-y-2">
                {c.seguros.map((s) => (
                  <li key={s.id} className="rounded-lg border border-border/60 p-3 bg-background flex items-start justify-between gap-2 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-sm font-medium">{s.modelo || "Apólice"}</span>
                        {s.status_label && <Badge variant="outline" className="text-[10px]">{s.status_label}</Badge>}
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{s.placa || "—"}</p>
                    </div>
                    <p className="text-sm font-semibold shrink-0">{BRL(s.mensal)}/mês</p>
                  </li>
                ))}
              </ul>
            </TabsContent>
          )}
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

function MiniKpi({ icon: Icon, label, value }: { icon: typeof Wallet; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/40 px-2.5 py-2">
      <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <p className="mt-0.5 text-sm font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-center text-xs text-muted-foreground py-6">{children}</p>;
}
