import { useState, useRef, useMemo, useCallback, useEffect } from "react";
import { Megaphone, Send, Loader2, Pause, Play, X, Shield, Timer, CheckCircle2, XCircle, Layers, ShieldAlert, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/components/ui/use-toast";
import { ContactImporter } from "./ContactImporter";
import { BlockConfigurator } from "./BlockConfigurator";
import { QuickTemplateForm } from "./QuickTemplateForm";
import { sendWhatsAppMessage } from "@/services/messageSender";
import { sendTemplate } from "@/services/templateSender";
import { getConnectionState } from "@/services/evolutionApi";
import { supabase } from "@/integrations/supabase/client";
import type { MessageTemplate, BulkContact, BlockConfig, BlockProgress } from "@/types/whatsapp";

interface Customer {
  id: string; name: string; phone_whatsapp: string; electricity_bill_value?: number;
  status?: string; devolutiva?: string | null; registered_by_name?: string | null;
  last_inbound_at?: string | null;
}

interface BulkBlockSendPanelProps {
  instanceName: string;
  customers: Customer[];
  templates: MessageTemplate[];
  applyTemplate: (t: MessageTemplate, c: { name: string; electricity_bill_value?: number }) => string;
  consultantId: string;
  onCreateTemplate: (name: string, content: string, mediaType?: string, mediaUrl?: string | null, imageUrl?: string | null) => Promise<void>;
}

const SEND_INTERVAL_MIN_S = 18;
const SEND_INTERVAL_MAX_S = 35;
const PROGRESSIVE_EXTRA_S = 5;
const MEDIA_JITTER_MIN_MS = 2000;
const MEDIA_JITTER_MAX_MS = 4000;
const CIRCUIT_BREAKER_THRESHOLD = 5;
const DAILY_SAFE_LIMIT = 200;

function getRandomInterval(messageIndex: number): number {
  const base = SEND_INTERVAL_MIN_S + Math.random() * (SEND_INTERVAL_MAX_S - SEND_INTERVAL_MIN_S);
  const progressive = Math.floor(messageIndex / 10) * PROGRESSIVE_EXTRA_S;
  return Math.round(base + progressive);
}

function isValidPhone(phone: string): boolean {
  if (!phone) return false;
  if (/sem_celular/i.test(phone)) return false;
  return phone.replace(/\D/g, "").length >= 10;
}

function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Normalize phone to digits only for deduplication */
function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

/** Deduplicate contacts by normalized phone */
function deduplicateContacts(contacts: BulkContact[]): { unique: BulkContact[]; removedCount: number } {
  const seen = new Set<string>();
  const unique: BulkContact[] = [];
  let removedCount = 0;
  for (const c of contacts) {
    const norm = normalizePhone(c.phone);
    if (seen.has(norm)) {
      removedCount++;
    } else {
      seen.add(norm);
      unique.push(c);
    }
  }
  return { unique, removedCount };
}

type BlockResult = { blockIndex: number; sent: number; failed: number };

export function BulkBlockSendPanel({ instanceName, customers, templates, applyTemplate, consultantId, onCreateTemplate }: BulkBlockSendPanelProps) {
  const [contacts, setContacts] = useState<BulkContact[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<MessageTemplate | null>(null);
  const [message, setMessage] = useState("");
  const [blockConfig, setBlockConfig] = useState<BlockConfig>({ blockSize: 20, intervalMinutes: 10 });
  const [progress, setProgress] = useState<BlockProgress | null>(null);
  const [blockResults, setBlockResults] = useState<BlockResult[]>([]);
  const [finalResult, setFinalResult] = useState<{ total: number; sent: number; failed: number } | null>(null);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [circuitBroken, setCircuitBroken] = useState(false);
  const [dailySentCount, setDailySentCount] = useState(0);
  const [duplicatesRemoved, setDuplicatesRemoved] = useState(0);
  const cancelledRef = useRef(false);
  const pausedRef = useRef(false);
  const [isPaused, setIsPaused] = useState(false);
  const { toast } = useToast();

  // Enrich customers with last_inbound_at from customer_flow_state (for "Últimas 48h" filter)
  const [lastInboundMap, setLastInboundMap] = useState<Map<string, string | null>>(new Map());
  useEffect(() => {
    let cancelled = false;
    const ids = customers.map(c => c.id).filter(Boolean);
    if (ids.length === 0) { setLastInboundMap(new Map()); return; }
    (async () => {
      const map = new Map<string, string | null>();
      const CHUNK = 500;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const slice = ids.slice(i, i + CHUNK);
        const { data, error } = await (supabase as any)
          .from("customer_flow_state")
          .select("customer_id,last_inbound_at")
          .in("customer_id", slice);
        if (error) continue;
        for (const row of (data as any[]) || []) {
          map.set(String(row.customer_id), row.last_inbound_at ?? null);
        }
        if (cancelled) return;
      }
      if (!cancelled) setLastInboundMap(map);
    })();
    return () => { cancelled = true; };
  }, [customers]);

  const enrichedCustomers = useMemo<Customer[]>(
    () => customers.map(c => ({ ...c, last_inbound_at: lastInboundMap.get(c.id) ?? null })),
    [customers, lastInboundMap],
  );

  const validContacts = useMemo(() => contacts.filter(c => isValidPhone(c.phone)), [contacts]);
  const isSending = progress !== null && !finalResult;

  const handlePause = useCallback(() => {
    pausedRef.current = !pausedRef.current;
    setIsPaused(pausedRef.current);
  }, []);

  const handleCancel = useCallback(() => {
    cancelledRef.current = true;
    pausedRef.current = false;
    setIsPaused(false);
  }, []);

  const sleep = useCallback((ms: number, onTick?: (remaining: number) => void): Promise<boolean> => {
    return new Promise(resolve => {
      let elapsed = 0;
      const interval = setInterval(() => {
        if (cancelledRef.current) { clearInterval(interval); resolve(false); return; }
        if (pausedRef.current) return;
        elapsed += 1000;
        const remaining = Math.max(0, Math.ceil((ms - elapsed) / 1000));
        onTick?.(remaining);
        if (elapsed >= ms) { clearInterval(interval); resolve(true); }
      }, 1000);
    });
  }, []);

  /** Media jitter: random 2-4s between media sends to same contact */
  const mediaJitter = useCallback(async (): Promise<boolean> => {
    const jitterMs = MEDIA_JITTER_MIN_MS + Math.random() * (MEDIA_JITTER_MAX_MS - MEDIA_JITTER_MIN_MS);
    return sleep(jitterMs);
  }, [sleep]);

  /** Check if WhatsApp is still connected before a block */
  const checkConnection = useCallback(async (): Promise<boolean> => {
    try {
      const result = await getConnectionState(instanceName);
      const state = result?.state || "close";
      return state === "open";
    } catch {
      return false;
    }
  }, [instanceName]);

  /** Show confirmation step before sending */
  const handlePreSend = useCallback(() => {
    if (validContacts.length === 0) return;
    const hasMedia = !!(selectedTemplate?.media_url || (selectedTemplate?.items && selectedTemplate.items.length > 0));
    if (!message.trim() && !hasMedia) return;

    // Deduplicate
    const { unique, removedCount } = deduplicateContacts(validContacts);
    setDuplicatesRemoved(removedCount);

    // Warn daily limit
    if (dailySentCount + unique.length > DAILY_SAFE_LIMIT) {
      toast({
        title: "⚠️ Limite diário próximo",
        description: `Você já enviou ${dailySentCount} hoje. Enviar mais ${unique.length} pode causar bloqueio.`,
        variant: "destructive",
      });
    }

    setShowConfirmation(true);
  }, [validContacts, message, selectedTemplate, dailySentCount, toast]);

  const handleSend = useCallback(async () => {
    setShowConfirmation(false);
    setCircuitBroken(false);

    // Deduplicate contacts before sending
    const { unique: dedupedContacts } = deduplicateContacts(validContacts);
    if (dedupedContacts.length === 0) return;

    cancelledRef.current = false;
    pausedRef.current = false;
    setIsPaused(false);
    setBlockResults([]);
    setFinalResult(null);

    const blocks: BulkContact[][] = [];
    for (let i = 0; i < dedupedContacts.length; i += blockConfig.blockSize) {
      blocks.push(dedupedContacts.slice(i, i + blockConfig.blockSize));
    }

    let totalSent = 0, totalFailed = 0;
    let globalIndex = 0; // Global index for progressive delay
    let consecutiveFailures = 0;

    const initProgress: BlockProgress = {
      currentBlock: 0, totalBlocks: blocks.length,
      sentInBlock: 0, failedInBlock: 0,
      totalSent: 0, totalFailed: 0, totalContacts: dedupedContacts.length,
      isPaused: false, isWaitingBetweenBlocks: false,
      blockCountdown: 0, messageCountdown: 0,
    };
    setProgress(initProgress);

    for (let b = 0; b < blocks.length; b++) {
      if (cancelledRef.current) break;

      // ── Connection check before each block ──
      const isConnected = await checkConnection();
      if (!isConnected) {
        toast({
          title: "⚠️ WhatsApp desconectado",
          description: "A conexão foi perdida. Envio pausado automaticamente. Verifique a conexão e retome.",
          variant: "destructive",
        });
        pausedRef.current = true;
        setIsPaused(true);
        // Wait for user to unpause or cancel
        while (pausedRef.current && !cancelledRef.current) {
          await new Promise(r => setTimeout(r, 1000));
        }
        if (cancelledRef.current) break;
        // Re-check after unpause
        const reconnected = await checkConnection();
        if (!reconnected) {
          toast({ title: "Conexão não restaurada", description: "Envio cancelado.", variant: "destructive" });
          break;
        }
      }

      const block = blocks[b];
      let sentInBlock = 0, failedInBlock = 0;

      setProgress(p => p ? { ...p, currentBlock: b, sentInBlock: 0, failedInBlock: 0, isWaitingBetweenBlocks: false } : p);

      for (let i = 0; i < block.length; i++) {
        if (cancelledRef.current) break;

        // Wait while paused
        while (pausedRef.current && !cancelledRef.current) {
          await new Promise(r => setTimeout(r, 500));
        }
        if (cancelledRef.current) break;

        const contact = block[i];
        const renderText = (txt: string) =>
          txt.includes("{{")
            ? applyTemplate(
                { id: "", consultant_id: "", name: "", content: txt, media_type: "text", media_url: null, image_url: null, created_at: "" },
                { name: contact.name, electricity_bill_value: contact.electricity_bill_value }
              )
            : txt;
        const hasTemplateItems = !!(selectedTemplate && ((selectedTemplate.items && selectedTemplate.items.length > 0) || selectedTemplate.media_url));

        try {
          let allOk = true;

          if (selectedTemplate && hasTemplateItems) {
            // Envia todos os itens do template em ordem (multi-arquivo).
            allOk = await sendTemplate(selectedTemplate, { instanceName, phone: contact.phone, renderText });
            if (message.trim()) {
              await mediaJitter();
              const r = await sendWhatsAppMessage({ instanceName, phone: contact.phone, mediaCategory: "text", text: renderText(message) });
              if (r.status === "failed") allOk = false;
            }
          } else if (message.trim()) {
            const r = await sendWhatsAppMessage({ instanceName, phone: contact.phone, mediaCategory: "text", text: renderText(message) });
            if (r.status === "failed") allOk = false;
          }

          if (allOk) {
            sentInBlock++; totalSent++;
            consecutiveFailures = 0; // Reset circuit breaker on success
          } else {
            failedInBlock++; totalFailed++;
            consecutiveFailures++;
          }
        } catch {
          failedInBlock++; totalFailed++;
          consecutiveFailures++;
        }

        // ── Circuit breaker ──
        if (consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
          setCircuitBroken(true);
          toast({
            title: "⚠️ Muitas falhas consecutivas",
            description: `${CIRCUIT_BREAKER_THRESHOLD} falhas seguidas detectadas. Envio pausado. Verifique a conexão.`,
            variant: "destructive",
          });
          pausedRef.current = true;
          setIsPaused(true);
          // Wait for user to manually resume or cancel
          while (pausedRef.current && !cancelledRef.current) {
            await new Promise(r => setTimeout(r, 500));
          }
          if (cancelledRef.current) break;
          consecutiveFailures = 0;
          setCircuitBroken(false);
        }

        setProgress(p => p ? {
          ...p, sentInBlock, failedInBlock, totalSent, totalFailed,
          isPaused: pausedRef.current,
        } : p);

        // Anti-spam interval using GLOBAL index
        if (i < block.length - 1 && !cancelledRef.current) {
          const intervalS = getRandomInterval(globalIndex);
          const ok = await sleep(intervalS * 1000, (rem) => {
            setProgress(p => p ? { ...p, messageCountdown: rem } : p);
          });
          setProgress(p => p ? { ...p, messageCountdown: 0 } : p);
          if (!ok) break;
        }

        globalIndex++; // Increment global counter
      }

      setBlockResults(prev => [...prev, { blockIndex: b, sent: sentInBlock, failed: failedInBlock }]);

      // Interval between blocks
      if (b < blocks.length - 1 && !cancelledRef.current) {
        setProgress(p => p ? { ...p, isWaitingBetweenBlocks: true } : p);
        const intervalMs = blockConfig.intervalMinutes * 60 * 1000;
        const ok = await sleep(intervalMs, (rem) => {
          setProgress(p => p ? { ...p, blockCountdown: rem } : p);
        });
        setProgress(p => p ? { ...p, blockCountdown: 0, isWaitingBetweenBlocks: false } : p);
        if (!ok) break;
      }
    }

    // Track daily sent count
    setDailySentCount(prev => prev + totalSent);

    const result = { total: dedupedContacts.length, sent: totalSent, failed: totalFailed };
    setFinalResult(result);
    toast({
      title: cancelledRef.current ? "Envio cancelado" : "Envio concluído",
      description: `${totalSent} enviadas, ${totalFailed} falhas`,
      variant: totalFailed > 0 ? "destructive" : "default",
    });
  }, [validContacts, message, selectedTemplate, blockConfig, instanceName, applyTemplate, sleep, toast, checkConnection, mediaJitter]);

  const resetAll = useCallback(() => {
    setProgress(null);
    setBlockResults([]);
    setFinalResult(null);
    setShowConfirmation(false);
    setCircuitBroken(false);
    setDuplicatesRemoved(0);
  }, []);

  const overallPct = progress ? ((progress.totalSent + progress.totalFailed) / progress.totalContacts) * 100 : 0;

  // Dedup stats for confirmation
  const { unique: previewDeduped } = useMemo(() => deduplicateContacts(validContacts), [validContacts]);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-card via-card to-orange-950/10">
      <div className="absolute -top-20 -right-20 w-40 h-40 bg-orange-500/3 rounded-full blur-3xl" />
      <div className="relative p-5 sm:p-7 space-y-5">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500/20 to-orange-600/10 flex items-center justify-center border border-orange-500/20">
            <Megaphone className="w-5 h-5 text-orange-400" />
          </div>
          <div>
            <h3 className="font-heading font-bold text-foreground text-lg">Envio em Massa por Blocos</h3>
            <p className="text-xs text-muted-foreground">Envie com segurança usando intervalos inteligentes</p>
          </div>
        </div>

        {!isSending && !finalResult && !showConfirmation && (
          <>
            {/* Step 1: Contacts */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="w-5 h-5 rounded-full bg-primary/20 text-primary text-[11px] font-bold flex items-center justify-center">1</span>
                <span className="text-sm font-bold text-foreground">Importar Contatos</span>
              </div>
              <ContactImporter
                customers={enrichedCustomers}
                contacts={contacts}
                onContactsChange={setContacts}
                instanceName={instanceName}
              />
            </div>

            {/* Step 2: Template */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="w-5 h-5 rounded-full bg-primary/20 text-primary text-[11px] font-bold flex items-center justify-center">2</span>
                <span className="text-sm font-bold text-foreground">Mensagem</span>
              </div>
              <QuickTemplateForm
                templates={templates}
                selectedTemplate={selectedTemplate}
                onSelectTemplate={setSelectedTemplate}
                message={message}
                onMessageChange={setMessage}
                onCreateTemplate={onCreateTemplate}
                contacts={contacts}
              />
            </div>

            {/* Step 3: Block Config */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="w-5 h-5 rounded-full bg-primary/20 text-primary text-[11px] font-bold flex items-center justify-center">3</span>
                <span className="text-sm font-bold text-foreground">Configurar Blocos</span>
              </div>
              <BlockConfigurator
                config={blockConfig}
                onConfigChange={setBlockConfig}
                totalContacts={previewDeduped.length}
                dailySentCount={dailySentCount}
              />
            </div>

            {/* Send button */}
            <Button
              onClick={handlePreSend}
              disabled={validContacts.length === 0 || (!message.trim() && !selectedTemplate?.media_url && !(selectedTemplate?.items && selectedTemplate.items.length > 0))}
              className="w-full gap-2 rounded-xl h-12 font-bold text-base shadow-lg shadow-green-500/10 hover:shadow-green-500/20 transition-all"
              style={{ background: "var(--gradient-green)" }}
            >
              <Send className="w-5 h-5" />
              Revisar e enviar para {previewDeduped.length} contatos
            </Button>
          </>
        )}

        {/* ── Confirmation step ── */}
        {showConfirmation && !isSending && !finalResult && (
          <div className="space-y-4">
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-5 space-y-3">
              <p className="text-sm font-bold text-foreground text-center">📋 Confirmar Envio</p>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">📱 Contatos</span>
                  <span className="font-bold text-foreground">
                    {previewDeduped.length}
                    {duplicatesRemoved > 0 && (
                      <span className="text-yellow-400 text-xs ml-1">({duplicatesRemoved} duplicados removidos)</span>
                    )}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">📝 Template</span>
                  <span className="font-medium text-foreground truncate max-w-[180px]">{selectedTemplate?.name || "Mensagem livre"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">📦 Blocos</span>
                  <span className="font-medium text-foreground">
                    {Math.ceil(previewDeduped.length / blockConfig.blockSize)} blocos de {blockConfig.blockSize} • {blockConfig.intervalMinutes}min intervalo
                  </span>
                </div>
                {dailySentCount > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">📊 Hoje</span>
                    <span className="font-medium text-foreground">{dailySentCount} já enviadas</span>
                  </div>
                )}
              </div>

              {dailySentCount + previewDeduped.length > DAILY_SAFE_LIMIT && (
                <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-2.5 flex items-start gap-2">
                  <ShieldAlert className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <p className="text-[11px] text-red-300">
                    ⚠️ Este envio ultrapassará o limite seguro de {DAILY_SAFE_LIMIT} mensagens/dia.
                    O risco de bloqueio é alto. Considere reduzir o volume.
                  </p>
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setShowConfirmation(false)} className="flex-1 rounded-xl h-10">
                Voltar
              </Button>
              <Button
                onClick={handleSend}
                className="flex-1 gap-2 rounded-xl h-10 font-bold"
                style={{ background: "var(--gradient-green)" }}
              >
                <Send className="w-4 h-4" /> Confirmar Envio
              </Button>
            </div>
          </div>
        )}

        {/* Sending progress */}
        {isSending && progress && (
          <div className="space-y-4">
            {/* Circuit breaker alert */}
            {circuitBroken && (
              <div className="rounded-xl bg-red-500/10 border border-red-500/30 p-3 flex items-start gap-2">
                <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-bold text-red-400">Circuit Breaker Ativado</p>
                  <p className="text-xs text-red-300/80">{CIRCUIT_BREAKER_THRESHOLD} falhas consecutivas. Verifique a conexão do WhatsApp e clique em Retomar.</p>
                </div>
              </div>
            )}

            {/* Overall progress */}
            <div className="rounded-xl bg-secondary/20 border border-border/30 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Loader2 className="w-4 h-4 animate-spin text-orange-400" />
                  Bloco {progress.currentBlock + 1}/{progress.totalBlocks}
                </div>
                <span className="text-xs text-muted-foreground">
                  {progress.totalSent + progress.totalFailed}/{progress.totalContacts} total
                </span>
              </div>
              <Progress value={overallPct} className="h-2.5" />
              <div className="flex gap-3 text-xs">
                <span className="text-green-400 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> {progress.totalSent} enviadas
                </span>
                {progress.totalFailed > 0 && (
                  <span className="text-red-400 flex items-center gap-1">
                    <XCircle className="w-3 h-3" /> {progress.totalFailed} falhas
                  </span>
                )}
              </div>
            </div>

            {/* Block-level detail */}
            <div className="rounded-xl bg-secondary/10 border border-border/30 p-3">
              <p className="text-xs font-medium text-muted-foreground mb-2">
                <Layers className="w-3 h-3 inline mr-1" />
                Bloco {progress.currentBlock + 1}: {progress.sentInBlock + progress.failedInBlock}/{
                  Math.min(blockConfig.blockSize, validContacts.length - progress.currentBlock * blockConfig.blockSize)
                }
              </p>
              <Progress
                value={
                  ((progress.sentInBlock + progress.failedInBlock) /
                    Math.min(blockConfig.blockSize, validContacts.length - progress.currentBlock * blockConfig.blockSize)) *
                  100
                }
                className="h-1.5"
              />
            </div>

            {/* Countdown between messages */}
            {progress.messageCountdown > 0 && !progress.isWaitingBetweenBlocks && (
              <div className="flex items-center gap-2.5 rounded-lg bg-blue-500/10 border border-blue-500/20 px-3 py-2">
                <Shield className="w-4 h-4 text-blue-400 shrink-0" />
                <div className="flex-1">
                  <p className="text-xs text-blue-300 font-medium">Anti-spam ativo</p>
                </div>
                <div className="flex items-center gap-1.5 bg-blue-500/15 px-2.5 py-1 rounded-full">
                  <Timer className="w-3.5 h-3.5 text-blue-400" />
                  <span className="text-sm font-mono font-bold text-blue-300">{progress.messageCountdown}s</span>
                </div>
              </div>
            )}

            {/* Countdown between blocks */}
            {progress.isWaitingBetweenBlocks && (
              <div className="rounded-xl bg-orange-500/10 border border-orange-500/30 p-4 text-center space-y-2">
                <p className="text-sm font-bold text-orange-300">⏳ Pausa entre blocos</p>
                <p className="text-4xl font-mono font-bold text-orange-400">
                  {formatCountdown(progress.blockCountdown)}
                </p>
                <p className="text-xs text-orange-300/70">
                  Próximo bloco: {progress.currentBlock + 2}/{progress.totalBlocks}
                </p>
              </div>
            )}

            {/* Block results so far */}
            {blockResults.length > 0 && (
              <div className="space-y-1">
                {blockResults.map(br => (
                  <div key={br.blockIndex} className="flex items-center gap-2 text-[11px] px-2 py-1 rounded bg-secondary/30">
                    <span className="text-muted-foreground">Bloco {br.blockIndex + 1}:</span>
                    <span className="text-green-400">{br.sent} ✓</span>
                    {br.failed > 0 && <span className="text-red-400">{br.failed} ✗</span>}
                  </div>
                ))}
              </div>
            )}

            {/* Controls */}
            <div className="flex gap-2">
              <Button variant="outline" onClick={handlePause} className="flex-1 gap-1.5 rounded-xl h-10">
                {isPaused ? <><Play className="w-4 h-4" /> Retomar</> : <><Pause className="w-4 h-4" /> Pausar</>}
              </Button>
              <Button variant="destructive" onClick={handleCancel} className="flex-1 gap-1.5 rounded-xl h-10">
                <X className="w-4 h-4" /> Cancelar
              </Button>
            </div>
          </div>
        )}

        {/* Final result */}
        {finalResult && (
          <div className="space-y-4">
            <div className="rounded-xl border border-border/40 bg-secondary/20 p-5 text-center space-y-3">
              <div className="w-12 h-12 mx-auto rounded-full bg-green-500/20 flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6 text-green-400" />
              </div>
              <p className="text-lg font-bold text-foreground">
                {cancelledRef.current ? "Envio cancelado" : "Envio concluído!"}
              </p>
              <div className="flex justify-center gap-6 text-sm font-medium">
                <span className="text-green-400">{finalResult.sent} enviadas</span>
                {finalResult.failed > 0 && <span className="text-red-400">{finalResult.failed} falhas</span>}
              </div>
              {blockResults.length > 0 && (
                <div className="text-left space-y-1 mt-3">
                  <p className="text-xs font-medium text-muted-foreground mb-1">Detalhes por bloco:</p>
                  {blockResults.map(br => (
                    <div key={br.blockIndex} className="flex items-center gap-2 text-[11px] px-2 py-1 rounded bg-secondary/30">
                      <span className="text-muted-foreground font-medium">Bloco {br.blockIndex + 1}:</span>
                      <span className="text-green-400">{br.sent} enviadas</span>
                      {br.failed > 0 && <span className="text-red-400">{br.failed} falhas</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <Button onClick={resetAll} variant="outline" className="w-full rounded-xl h-10">
              Novo envio
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
