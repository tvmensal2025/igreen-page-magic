import { Shield, Zap, Rabbit, Calendar, Clock, Layers } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { PRESETS, type SendConfig, type SpeedPreset } from "./types";

function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface Props {
  config: SendConfig;
  onChange: (c: SendConfig) => void;
  totalContacts: number;
}

const PRESET_META: { key: SpeedPreset; label: string; desc: string; icon: any; activeCls: string; iconCls: string }[] = [
  { key: "safe",   label: "Seguro",  desc: "15 por bloco, 15min pausa, ~30s entre", icon: Shield, activeCls: "border-primary/50 bg-primary/10", iconCls: "text-primary" },
  { key: "normal", label: "Normal",  desc: "25 por bloco, 10min pausa, ~25s entre", icon: Zap,    activeCls: "border-info/50 bg-info/10",       iconCls: "text-info" },
  { key: "fast",   label: "Rápido",  desc: "40 por bloco, 5min pausa, ~15s entre",  icon: Rabbit, activeCls: "border-warning/50 bg-warning/10",   iconCls: "text-warning" },
];

export function ScheduleStep({ config, onChange, totalContacts }: Props) {
  const applyPreset = (key: SpeedPreset) => {
    if (key === "custom") { onChange({ ...config, preset: "custom" }); return; }
    onChange({ ...config, preset: key, ...PRESETS[key] });
  };

  // Estimate time
  const avgIntervalS = (config.intervalMinS + config.intervalMaxS) / 2;
  const blocks = Math.max(1, Math.ceil(totalContacts / config.blockSize));
  const totalSeconds = totalContacts * avgIntervalS + (blocks - 1) * config.blockPauseMin * 60;
  const eta = totalSeconds < 60
    ? `${Math.round(totalSeconds)}s`
    : totalSeconds < 3600
      ? `${Math.round(totalSeconds / 60)}min`
      : `${(totalSeconds / 3600).toFixed(1)}h`;

  return (
    <div className="space-y-5">
      {/* Speed presets */}
      <div>
        <Label className="text-sm font-bold mb-2 block">Velocidade do envio</Label>
        <div className="grid sm:grid-cols-3 gap-2">
          {PRESET_META.map(p => {
            const Icon = p.icon;
            const active = config.preset === p.key;
            return (
              <button
                key={p.key} type="button" onClick={() => applyPreset(p.key)}
                className={`text-left p-3 rounded-xl border transition-all ${
                  active ? p.activeCls : "border-border/40 bg-secondary/20 hover:bg-secondary/40"
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Icon className={`w-4 h-4 ${p.iconCls}`} />
                  <span className="text-sm font-bold text-foreground">{p.label}</span>
                </div>
                <p className="text-[11px] text-muted-foreground">{p.desc}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Custom knobs */}
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <Label className="text-xs text-muted-foreground">Tamanho do bloco</Label>
          <Input
            type="number" min={5} max={50}
            value={config.blockSize}
            onChange={(e) => onChange({ ...config, preset: "custom", blockSize: Number(e.target.value) || 25 })}
          />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Pausa entre blocos (min)</Label>
          <Input
            type="number" min={1} max={120}
            value={config.blockPauseMin}
            onChange={(e) => onChange({ ...config, preset: "custom", blockPauseMin: Number(e.target.value) || 10 })}
          />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Intervalo mínimo (seg)</Label>
          <Input
            type="number" min={5} max={120}
            value={config.intervalMinS}
            onChange={(e) => onChange({ ...config, preset: "custom", intervalMinS: Number(e.target.value) || 18 })}
          />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Intervalo máximo (seg)</Label>
          <Input
            type="number" min={5} max={180}
            value={config.intervalMaxS}
            onChange={(e) => onChange({ ...config, preset: "custom", intervalMaxS: Number(e.target.value) || 32 })}
          />
        </div>
      </div>

      {/* Window */}
      <div className="rounded-xl border border-border/40 bg-secondary/10 p-3 space-y-3">
        <div className="flex items-center gap-2"><Clock className="w-4 h-4 text-muted-foreground" /><span className="text-sm font-bold">Janela permitida</span></div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs text-muted-foreground">Início</Label>
            <Input type="time" value={config.windowStart} onChange={(e) => onChange({ ...config, windowStart: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Fim</Label>
            <Input type="time" value={config.windowEnd} onChange={(e) => onChange({ ...config, windowEnd: e.target.value })} />
          </div>
        </div>
        <label className="flex items-center justify-between gap-2 text-sm">
          <span>Pular finais de semana</span>
          <Switch checked={config.weekdaysOnly} onCheckedChange={(v) => onChange({ ...config, weekdaysOnly: v })} />
        </label>
      </div>

      {/* Media order — só relevante se houver anexo, mas sempre visível para configurar */}
      <div className="rounded-xl border border-border/40 bg-secondary/10 p-3 space-y-2">
        <div className="flex items-center gap-2"><Layers className="w-4 h-4 text-muted-foreground" /><span className="text-sm font-bold">Ordem do anexo (quando houver)</span></div>
        <div className="grid grid-cols-3 gap-2">
          {([
            { v: "media_first", label: "Anexo primeiro", desc: "Manda anexo, depois texto" },
            { v: "text_first",  label: "Texto primeiro", desc: "Manda texto, depois anexo" },
            { v: "caption_only", label: "Como legenda",  desc: "Texto vai na legenda da mídia" },
          ] as const).map(o => (
            <button
              key={o.v} type="button"
              onClick={() => onChange({ ...config, mediaOrder: o.v })}
              className={`text-left p-2 rounded-lg border text-[11px] transition-all ${
                config.mediaOrder === o.v ? "border-primary/50 bg-primary/10" : "border-border/40 bg-secondary/20 hover:bg-secondary/40"
              }`}
            >
              <p className="font-bold text-foreground text-xs">{o.label}</p>
              <p className="text-muted-foreground">{o.desc}</p>
            </button>
          ))}
        </div>
      </div>
144: 
145:       {/* Post-send action */}
146:       <div className="rounded-xl border border-border/40 bg-secondary/10 p-3 space-y-3">
147:         <div className="flex items-center gap-2"><Zap className="w-4 h-4 text-muted-foreground" /><span className="text-sm font-bold">Após o envio</span></div>
148:         <div className="grid grid-cols-2 gap-2">
149:           <button
150:             type="button" onClick={() => onChange({ ...config, afterSendAction: "handoff" })}
151:             className={`px-3 py-2 rounded-lg text-left border transition-all ${config.afterSendAction !== "grupo_a" ? "border-primary/50 bg-primary/10" : "border-border/40 bg-secondary/20"}`}
152:           >
153:             <p className="text-xs font-bold">Aguardar Humano</p>
154:             <p className="text-[10px] text-muted-foreground">Pausa o bot (Handoff 48h)</p>
155:           </button>
156:           <button
157:             type="button" onClick={() => onChange({ ...config, afterSendAction: "grupo_a" })}
158:             className={`px-3 py-2 rounded-lg text-left border transition-all ${config.afterSendAction === "grupo_a" ? "border-primary/50 bg-primary/10" : "border-border/40 bg-secondary/20"}`}
159:           >
160:             <p className="text-xs font-bold">Auto-Cadastro (IA)</p>
161:             <p className="text-[10px] text-muted-foreground">Inicia funil Sofia Grupo A</p>
162:           </button>
163:         </div>
164:         <p className="text-[10px] text-muted-foreground leading-tight">
165:           {config.afterSendAction === "grupo_a" 
166:             ? "Os leads serão direcionados para o funil automático de cadastro (Grupo A) assim que receberem a mensagem."
167:             : "O robô será pausado para cada lead, permitindo que você assuma a conversa manualmente no WhatsApp."}
168:         </p>
169:       </div>

      {/* Schedule */}
      <div className="rounded-xl border border-border/40 bg-secondary/10 p-3 space-y-3">
        <div className="flex items-center gap-2"><Calendar className="w-4 h-4 text-muted-foreground" /><span className="text-sm font-bold">Agendamento</span></div>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button" onClick={() => onChange({ ...config, scheduleAt: null })}
            className={`px-3 py-2 rounded-lg text-sm font-medium border ${!config.scheduleAt ? "border-primary/50 bg-primary/10 text-primary" : "border-border/40 bg-secondary/20"}`}
          >Enviar agora</button>
          <button
            type="button" onClick={() => onChange({ ...config, scheduleAt: toLocalInputValue(new Date(Date.now() + 3600_000)) })}
            className={`px-3 py-2 rounded-lg text-sm font-medium border ${config.scheduleAt ? "border-primary/50 bg-primary/10 text-primary" : "border-border/40 bg-secondary/20"}`}
          >Agendar</button>
        </div>
        {config.scheduleAt && (
          <Input
            type="datetime-local"
            value={config.scheduleAt.slice(0, 16)}
            onChange={(e) => onChange({ ...config, scheduleAt: e.target.value })}
          />
        )}
        <p className="text-[11px] text-muted-foreground">
          {config.scheduleAt
            ? "Envio agendado: o robô do servidor dispara no horário marcado, sem precisar da aba aberta — desde que a automação \"Campanhas em massa\" esteja ligada na Central de Agendamentos. Com a aba aberta o envio também continua daqui."
            : "Envio imediato: começa agora e roda enquanto esta aba estiver aberta. Se fechar, o robô do servidor retoma de onde parou (automação \"Campanhas em massa\" ligada)."}
        </p>
      </div>

      {/* ETA */}
      <div className="rounded-xl bg-primary/10 border border-primary/30 p-3 text-center">
        <p className="text-[11px] text-primary/80 uppercase tracking-wide">Tempo estimado</p>
        <p className="text-2xl font-bold text-primary">{eta}</p>
        <p className="text-[11px] text-primary/70">{totalContacts} contatos • {blocks} blocos</p>
      </div>
    </div>
  );
}
