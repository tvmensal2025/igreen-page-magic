import { useMemo } from "react";
import { Layers, Clock, Zap, Info, ShieldCheck, ShieldAlert, AlertTriangle } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { BlockConfig } from "@/types/whatsapp";

interface BlockConfiguratorProps {
  config: BlockConfig;
  onConfigChange: (config: BlockConfig) => void;
  totalContacts: number;
  disabled?: boolean;
  dailySentCount?: number;
}

const BLOCK_SIZES = [10, 20, 30, 40, 50] as const;
const INTERVAL_OPTIONS = [
  { value: 5, label: "5 min" },
  { value: 10, label: "10 min" },
  { value: 15, label: "15 min" },
  { value: 30, label: "30 min" },
  { value: 60, label: "1 hora" },
] as const;

const AVG_MSG_INTERVAL_S = 26.5; // avg of 18-35
const PROGRESSIVE_EXTRA_S = 5;
const DAILY_SAFE_LIMIT = 200;

function estimateBlockTime(blockSize: number): number {
  let total = 0;
  for (let i = 0; i < blockSize - 1; i++) {
    total += AVG_MSG_INTERVAL_S + Math.floor(i / 10) * PROGRESSIVE_EXTRA_S;
  }
  return Math.round(total);
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h ${m}min` : `${h}h`;
  return `${m}min`;
}

type RiskLevel = "safe" | "moderate" | "risky";

function getRiskLevel(totalContacts: number, intervalMinutes: number, dailySent: number): RiskLevel {
  const totalToday = dailySent + totalContacts;
  if (totalToday > DAILY_SAFE_LIMIT || intervalMinutes < 10) return "risky";
  if (totalToday > 100 || intervalMinutes < 15) return "moderate";
  return "safe";
}

const RISK_CONFIG: Record<RiskLevel, { label: string; color: string; bg: string; border: string; icon: typeof ShieldCheck; emoji: string }> = {
  safe: { label: "Seguro", color: "text-primary", bg: "bg-primary/10", border: "border-primary/20", icon: ShieldCheck, emoji: "🟢" },
  moderate: { label: "Moderado", color: "text-warning", bg: "bg-warning/10", border: "border-warning/20", icon: AlertTriangle, emoji: "🟡" },
  risky: { label: "Arriscado", color: "text-destructive", bg: "bg-destructive/10", border: "border-destructive/20", icon: ShieldAlert, emoji: "🔴" },
};

export function BlockConfigurator({ config, onConfigChange, totalContacts, disabled, dailySentCount = 0 }: BlockConfiguratorProps) {
  const stats = useMemo(() => {
    if (totalContacts === 0) return { blocks: 0, lastBlockSize: 0, totalTime: 0 };
    const blocks = Math.ceil(totalContacts / config.blockSize);
    const lastBlockSize = totalContacts % config.blockSize || config.blockSize;
    const fullBlocks = blocks > 1 ? blocks - 1 : 0;
    const blockTime = estimateBlockTime(config.blockSize);
    const lastBlockTime = estimateBlockTime(lastBlockSize);
    const intervalTime = fullBlocks * config.intervalMinutes * 60;
    const totalTime = fullBlocks * blockTime + lastBlockTime + intervalTime;
    return { blocks, lastBlockSize, totalTime };
  }, [totalContacts, config]);

  const risk = useMemo(
    () => getRiskLevel(totalContacts, config.intervalMinutes, dailySentCount),
    [totalContacts, config.intervalMinutes, dailySentCount]
  );
  const riskCfg = RISK_CONFIG[risk];
  const RiskIcon = riskCfg.icon;

  return (
    <div className="rounded-lg border border-border/50 bg-secondary/10 p-4 space-y-4">
      <div className="flex items-center gap-2 text-sm font-bold text-foreground">
        <Layers className="w-4 h-4 text-primary" />
        Configuração dos Blocos
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
            <Zap className="w-3 h-3" /> Contatos por bloco
          </label>
          <Select
            value={String(config.blockSize)}
            onValueChange={v => onConfigChange({ ...config, blockSize: Number(v) as BlockConfig["blockSize"] })}
            disabled={disabled}
          >
            <SelectTrigger className="rounded-lg h-9 text-sm bg-secondary/50 border-border/50">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BLOCK_SIZES.map(s => (
                <SelectItem key={s} value={String(s)}>{s} contatos</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
            <Clock className="w-3 h-3" /> Intervalo entre blocos
          </label>
          <Select
            value={String(config.intervalMinutes)}
            onValueChange={v => onConfigChange({ ...config, intervalMinutes: Number(v) as BlockConfig["intervalMinutes"] })}
            disabled={disabled}
          >
            <SelectTrigger className="rounded-lg h-9 text-sm bg-secondary/50 border-border/50">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {INTERVAL_OPTIONS.map(o => (
                <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Risk indicator */}
      {totalContacts > 0 && (
        <div className={`rounded-lg ${riskCfg.bg} ${riskCfg.border} border p-3 space-y-1`}>
          <div className={`flex items-center gap-2 text-xs font-bold ${riskCfg.color}`}>
            <RiskIcon className="w-4 h-4" />
            {riskCfg.emoji} Nível de risco: {riskCfg.label}
          </div>
          {risk === "risky" && (
            <p className="text-[11px] text-destructive/80">
              ⚠️ Alto risco de bloqueio. Recomendamos no máximo {DAILY_SAFE_LIMIT} envios/dia com intervalo ≥10min.
            </p>
          )}
          {risk === "moderate" && (
            <p className="text-[11px] text-warning/80">
              Atenção: aumente o intervalo entre blocos para maior segurança.
            </p>
          )}
          {risk === "safe" && (
            <p className="text-[11px] text-primary/80">
              Configuração segura. Bom volume com intervalos adequados.
            </p>
          )}
          <p className="text-[10px] text-muted-foreground">
            Hoje: {dailySentCount} enviadas • Limite recomendado: {DAILY_SAFE_LIMIT}/dia
          </p>
        </div>
      )}

      {totalContacts > 0 && (
        <div className="rounded-lg bg-primary/5 border border-primary/20 p-3 space-y-2">
          <div className="flex items-center gap-2 text-xs font-medium text-primary">
            <Info className="w-3.5 h-3.5" /> Resumo do envio
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-secondary/40 p-2">
              <p className="text-lg font-bold text-foreground">{stats.blocks}</p>
              <p className="text-[10px] text-muted-foreground">blocos</p>
            </div>
            <div className="rounded-lg bg-secondary/40 p-2">
              <p className="text-lg font-bold text-foreground">{config.blockSize}</p>
              <p className="text-[10px] text-muted-foreground">por bloco</p>
            </div>
            <div className="rounded-lg bg-secondary/40 p-2">
              <p className="text-lg font-bold text-foreground">~{formatDuration(stats.totalTime)}</p>
              <p className="text-[10px] text-muted-foreground">tempo total</p>
            </div>
          </div>
          {stats.blocks > 1 && stats.lastBlockSize !== config.blockSize && (
            <p className="text-[11px] text-muted-foreground text-center">
              Último bloco: {stats.lastBlockSize} contatos
            </p>
          )}
        </div>
      )}
    </div>
  );
}
