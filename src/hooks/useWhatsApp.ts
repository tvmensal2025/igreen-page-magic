import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  createInstance,
  connectInstance,
  getConnectionState,
  logoutInstance,
  deleteInstance,
  EvolutionAuthError,
} from "@/services/evolutionApi";
import type { ConnectionStatus } from "@/types/whatsapp";
import {
  type OperationalHealth,
  REL_LOGIN_MESSAGE,
  MAX_CONSECUTIVE_TIMEOUTS,
  MAX_RECOVERY_CYCLES_WITHOUT_SIGNAL,
  DEGRADED_POLL_INTERVAL,
  HEALTHY_POLL_INTERVAL,
  logEntry,
  sanitize,
  getFixedInstanceName,
  isAuthError,
  isRecoverableConnectionError,
  sleep,
  withTimeout,
} from "./whatsapp/whatsappHelpers";
import { useWhatsAppInstanceDb } from "./whatsapp/useWhatsAppInstanceDb";
import { createHealthControls } from "./whatsapp/whatsappHealth";
import { createStateChecks } from "./whatsapp/whatsappStateChecks";

export type { OperationalHealth } from "./whatsapp/whatsappHelpers";

interface UseWhatsAppReturn {
  connectionStatus: ConnectionStatus;
  instanceName: string | null;
  qrCode: string | null;
  qrGeneratedAt: number | null;
  phoneNumber: string | null;
  isLoading: boolean;
  error: string | null;
  connectionLog: string[];
  operationalHealth: OperationalHealth;
  consecutiveTimeouts: number;
  isWhapi: boolean;
  hasInstance: boolean;
  createAndConnect: () => Promise<void>;
  disconnect: () => Promise<void>;
  reconnect: () => Promise<void>;
  refreshQr: () => Promise<void>;
  safeReset: () => Promise<void>;
}

export function useWhatsApp(consultantId: string): UseWhatsAppReturn {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("disconnected");
  const [instanceName, setInstanceName] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [qrGeneratedAt, setQrGeneratedAt] = useState<number | null>(null);
  const [isWhapi, setIsWhapi] = useState(false);
  const [hasInstance, setHasInstance] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectionLog, setConnectionLog] = useState<string[]>([]);
  const [operationalHealth, setOperationalHealth] = useState<OperationalHealth>("healthy");
  const [consecutiveTimeouts, setConsecutiveTimeouts] = useState(0);

  const mountedRef = useRef(true);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lockRef = useRef(false);
  const graceCountRef = useRef(0);
  const instanceSavedRef = useRef(false);
  const statusRef = useRef<ConnectionStatus>("disconnected");
  const timeoutCountRef = useRef(0);
  const healthRef = useRef<OperationalHealth>("healthy");
  const recoveryCyclesRef = useRef(0);

  const { saveInstance, deleteInstanceDb, fetchAndSaveConnectedPhone, ensureWebhook } =
    useWhatsAppInstanceDb(consultantId);

  const setStatus = useCallback((status: ConnectionStatus) => {
    statusRef.current = status;
    setConnectionStatus(status);
  }, []);

  const setHealth = useCallback((health: OperationalHealth) => {
    healthRef.current = health;
    setOperationalHealth(health);
  }, []);

  const addLog = useCallback((msg: string) => {
    setConnectionLog((prev) => [...prev.slice(-14), logEntry(sanitize(msg))]);
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearTimeout(pollRef.current); pollRef.current = null; }
  }, []);

  // ── Health controls (factory) ──
  const health = createHealthControls({
    healthRef, setHealth, timeoutCountRef, setConsecutiveTimeouts,
    recoveryCyclesRef, addLog,
  });

  // ── State checks (factory) ──
  const checks = createStateChecks({
    health, setHealth, timeoutCountRef, addLog,
  });

  const haltRecovery = useCallback((message: string) => {
    stopPolling();
    graceCountRef.current = 0;
    recoveryCyclesRef.current = 0;
    setStatus("disconnected");
    setQrCode(null);
    setQrGeneratedAt(null);
    setError(null);

    const nextHealth: OperationalHealth = timeoutCountRef.current >= MAX_CONSECUTIVE_TIMEOUTS
      ? "reset_recommended"
      : "degraded";

    setHealth(nextHealth);
    addLog(message);

    if (nextHealth === "reset_recommended") {
      addLog("🛡️ Recuperação automática pausada para evitar loop. Use Resetar Conexão.");
    }
  }, [addLog, setHealth, setStatus, stopPolling]);

  const handleAuthFailure = useCallback((err: EvolutionAuthError) => {
    stopPolling();
    setQrCode(null);
    setQrGeneratedAt(null);
    setStatus("disconnected");

    if (err.requiresRelogin) {
      setError(REL_LOGIN_MESSAGE);
      addLog("⚠️ Sessão expirada. Faça login novamente.");
      return;
    }

    setError("Autenticando novamente...");
    addLog("🔄 Atualizando autenticação...");
  }, [addLog, setStatus, stopPolling]);

  const markConnected = useCallback(async (name: string, message?: string) => {
    graceCountRef.current = 0;
    health.resetTimeoutCounter();
    health.resetRecoveryCounter();

    if (statusRef.current !== "connected" && message) addLog(message);

    setQrCode(null);
    setQrGeneratedAt(null);
    setError(null);
    setStatus("connected");
    setHealth("healthy");

    if (!instanceSavedRef.current) {
      try {
        await saveInstance(name);
        instanceSavedRef.current = true; setHasInstance(true);
        setHasInstance(true);
        ensureWebhook(name);
      } catch { /* non-critical */ }
    }
    setHasInstance(true);
    fetchAndSaveConnectedPhone(name).catch(() => {/* non-critical */});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addLog, ensureWebhook, fetchAndSaveConnectedPhone, saveInstance, setHealth, setStatus]);

  /* ── Unified polling loop with circuit breaker ── */
  const startPolling = useCallback((name: string) => {
    stopPolling();

    const poll = async () => {
      if (!mountedRef.current) return;

      if (timeoutCountRef.current >= MAX_CONSECUTIVE_TIMEOUTS) {
        if (healthRef.current !== "reset_recommended") {
          setHealth("reset_recommended");
          addLog("⚠️ Servidor instável. Recomendamos resetar a conexão.");
        }
        pollRef.current = setTimeout(poll, DEGRADED_POLL_INTERVAL);
        return;
      }

      try {
        const schedulePendingRecovery = (nextPollMs: number, message: string) => {
          recoveryCyclesRef.current += 1;
          if (recoveryCyclesRef.current >= MAX_RECOVERY_CYCLES_WITHOUT_SIGNAL) {
            haltRecovery("⚠️ Não foi possível recuperar a conexão automaticamente. Use Reconectar ou Resetar Conexão.");
            return false;
          }
          addLog(message);
          pollRef.current = setTimeout(poll, nextPollMs);
          return true;
        };

        const state = timeoutCountRef.current >= 2
          ? await checks.multiSignalCheck(name)
          : await checks.checkState(name);

        if (!mountedRef.current) return;

        if (state === "open") {
          await markConnected(name, "✅ WhatsApp conectado!");
          pollRef.current = setTimeout(poll, HEALTHY_POLL_INTERVAL);
          return;
        }

        if (state === "missing") {
          graceCountRef.current = 0;
          health.resetRecoveryCounter();
          setStatus("disconnected");
          setQrCode(null);
          setQrGeneratedAt(null);
          setError(null);
          setHealth("needs_qr");
          if (statusRef.current !== "disconnected") {
            addLog("ℹ️ Instância não encontrada. Clique em Conectar para gerar um novo QR Code");
          }
          return;
        }

        if (state === "connecting" || state === "unknown") {
          const maxGraceChecks = statusRef.current === "connected" ? 6 : 2;
          if (graceCountRef.current < maxGraceChecks) {
            if (statusRef.current === "connected" && graceCountRef.current === 0) {
              addLog("🔄 Verificando estabilidade da conexão...");
              setHealth("degraded");
            }
            graceCountRef.current++;
            const pollInterval = timeoutCountRef.current >= 2 ? 15000 : 10000;
            pollRef.current = setTimeout(poll, pollInterval);
            return;
          }

          setStatus("connecting");
          setHealth("recovering");
          const qrAttempt = await checks.tryGetQr(name);
          const recoveredConnection = qrAttempt.alreadyConnected || (
            !qrAttempt.qr && await checks.confirmConnectedState(name, 2, 1000)
          );
          if (!mountedRef.current) return;

          if (recoveredConnection) {
            await markConnected(name, "✅ WhatsApp conectado!");
            pollRef.current = setTimeout(poll, HEALTHY_POLL_INTERVAL);
            return;
          }

          if (qrAttempt.qr) {
            health.resetRecoveryCounter();
            setQrCode(qrAttempt.qr);
            setQrGeneratedAt(Date.now());
            setError(null);
            setHealth("needs_qr");
            addLog("📱 QR Code gerado — escaneie com seu celular");
            // Polling mínimo 30s durante QR (era 10s). Pedir QR a cada
            // poucos segundos é interpretado como bot e contribui para ban.
            pollRef.current = setTimeout(poll, 30000);
            return;
          }

          if (!schedulePendingRecovery(30000, "⏳ Ainda aguardando um sinal confiável do servidor...")) return;
          return;
        }

        if (statusRef.current === "connected" && graceCountRef.current < 3) {
          if (graceCountRef.current === 0) {
            addLog("🔄 Tentando recuperar a sessão do WhatsApp...");
            setHealth("recovering");
          }
          graceCountRef.current++;
          pollRef.current = setTimeout(poll, 15000);
          return;
        }

        graceCountRef.current = 0;
        setStatus("connecting");
        setHealth("recovering");
        const qrAttempt = await checks.tryGetQr(name);
        const recoveredConnection = qrAttempt.alreadyConnected || (
          !qrAttempt.qr && await checks.confirmConnectedState(name, 2, 1000)
        );
        if (!mountedRef.current) return;

        if (recoveredConnection) {
          await markConnected(name, "✅ WhatsApp conectado!");
          pollRef.current = setTimeout(poll, HEALTHY_POLL_INTERVAL);
          return;
        }

        if (qrAttempt.qr) {
          health.resetRecoveryCounter();
          setQrCode(qrAttempt.qr);
          setQrGeneratedAt(Date.now());
          setError(null);
          setHealth("needs_qr");
          addLog("📱 QR Code gerado — escaneie com seu celular");
          pollRef.current = setTimeout(poll, 30000);
          return;
        }

        if (!schedulePendingRecovery(30000, "⏳ Conexão ainda sem resposta estável. Nova tentativa em instantes...")) return;
      } catch (err) {
        if (isAuthError(err)) {
          handleAuthFailure(err);
          return;
        }
        pollRef.current = setTimeout(poll, 10000);
      }
    };

    void poll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addLog, handleAuthFailure, haltRecovery, markConnected, setHealth, setStatus, stopPolling]);

  /* ── Create & Connect ── */
  const createAndConnect = useCallback(async () => {
    if (lockRef.current) return;

    // 🔒 Anti-ban: impede que duas abas peçam QR simultaneamente para a mesma
    // instância. Pedidos de QR duplos/rápidos são interpretados como bot pelo
    // WhatsApp e contribuem para banimento. Best-effort: BroadcastChannel só
    // funciona se duas abas estiverem abertas no mesmo navegador.
    try {
      const name0 = getFixedInstanceName(consultantId);
      const ch = new BroadcastChannel("whatsapp-qr-lock");
      let blocked = false;
      const onMsg = (ev: MessageEvent) => {
        if (ev.data?.instance === name0 && ev.data?.type === "qr-lock-active") blocked = true;
      };
      ch.addEventListener("message", onMsg);
      ch.postMessage({ type: "qr-lock-query", instance: name0, ts: Date.now() });
      await new Promise((r) => setTimeout(r, 250));
      ch.removeEventListener("message", onMsg);
      if (blocked) {
        ch.close();
        addLog("⚠️ Outra aba já está gerando QR para esta instância. Use aquela aba.");
        setError("Outra aba já está gerando QR para esta instância. Feche-a antes de tentar aqui.");
        return;
      }
      // Anuncia lock e mantém o canal vivo até finalizar
      const lockInterval = setInterval(() => {
        ch.postMessage({ type: "qr-lock-active", instance: name0, ts: Date.now() });
      }, 2000);
      ch.addEventListener("message", (ev) => {
        if (ev.data?.type === "qr-lock-query" && ev.data?.instance === name0) {
          ch.postMessage({ type: "qr-lock-active", instance: name0, ts: Date.now() });
        }
      });
      // Libera após 5 min
      setTimeout(() => { clearInterval(lockInterval); ch.close(); }, 5 * 60 * 1000);
    } catch { /* navegador sem BroadcastChannel, não bloquear */ }

    lockRef.current = true;

    setIsLoading(true);
    setError(null);
    setConnectionLog([]);
    setQrCode(null);
    setQrGeneratedAt(null);
    instanceSavedRef.current = false;
    health.resetRecoveryCounter();
    timeoutCountRef.current = 0;
    setConsecutiveTimeouts(0);
    setHealth("healthy");
    stopPolling();

    const name = getFixedInstanceName(consultantId);
    setInstanceName(name);

    try {
      addLog("Verificando conexão...");
      const state = await checks.checkState(name);
      if (!mountedRef.current) return;

      if (state === "open") {
        await markConnected(name, "✅ WhatsApp já está conectado!");
        startPolling(name);
        return;
      }

      if (state === "connecting" || state === "close") {
        addLog("⏳ Recuperando QR Code...");
        setHealth("recovering");
        const qrAttempt = await checks.tryGetQr(name);
        const recoveredConnection = qrAttempt.alreadyConnected || (
          !qrAttempt.qr && await checks.confirmConnectedState(name, 2, 1000)
        );
        if (!mountedRef.current) return;

        if (recoveredConnection) {
          await markConnected(name, "✅ WhatsApp já está conectado!");
          startPolling(name);
          return;
        }

        if (qrAttempt.qr) {
          health.resetRecoveryCounter();
          await saveInstance(name);
          instanceSavedRef.current = true; setHasInstance(true);
          setQrCode(qrAttempt.qr);
          setQrGeneratedAt(Date.now());
          setStatus("connecting");
          setHealth("needs_qr");
          addLog("📱 QR Code gerado — escaneie com seu celular");
          startPolling(name);
          return;
        }

        await saveInstance(name);
        instanceSavedRef.current = true; setHasInstance(true);
        setStatus("connecting");
        addLog("⏳ Aguardando QR Code...");
        startPolling(name);
        return;
      }

      if (state === "unknown") {
        addLog("⚠️ Servidor instável. Tentando criar ou recuperar a conexão...");
        setHealth("degraded");
      }

      addLog("Criando instância...");
      try {
        const response = await withTimeout(createInstance(name), 15000);
        if (!mountedRef.current) return;

        await saveInstance(name);
        instanceSavedRef.current = true; setHasInstance(true);
        const qr = response?.qrcode?.base64 || null;

        if (qr) {
          health.resetRecoveryCounter();
          setQrCode(qr);
          setQrGeneratedAt(Date.now());
          setStatus("connecting");
          setHealth("needs_qr");
          addLog("📱 QR Code gerado — escaneie com seu celular");
        } else {
          setStatus("connecting");
          addLog("⏳ Instância criada. Aguardando QR Code...");
        }
        startPolling(name);
      } catch (createErr) {
        if (isAuthError(createErr)) { handleAuthFailure(createErr); return; }

        const msg = sanitize(createErr instanceof Error ? createErr.message : "Erro");

        if (msg.includes("already") || msg.includes("403") || msg.includes("409") || msg.includes("exists")) {
          await saveInstance(name);
          instanceSavedRef.current = true; setHasInstance(true);
          setStatus("connecting");
          addLog("⏳ Instância já existe. Conectando...");
          startPolling(name);
          return;
        }

        if (isRecoverableConnectionError(msg)) {
          await saveInstance(name);
          instanceSavedRef.current = true; setHasInstance(true);
          setStatus("connecting");
          setError(null);
          setHealth("degraded");
          addLog("⏳ Servidor instável. Tentando recuperar a instância...");
          startPolling(name);
          return;
        }

        setStatus("disconnected");
        setError(msg);
        addLog("❌ " + msg);
      }
    } catch (err) {
      if (isAuthError(err)) { handleAuthFailure(err); return; }

      const msg = sanitize(err instanceof Error ? err.message : "Erro ao conectar");

      if (isRecoverableConnectionError(msg)) {
        setStatus("connecting");
        setError(null);
        setHealth("degraded");
        addLog("⏳ Conexão instável. Tentando novamente...");
        startPolling(name);
      } else {
        setStatus("disconnected");
        setError(msg);
        addLog("❌ " + msg);
      }
    } finally {
      lockRef.current = false;
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consultantId, addLog, handleAuthFailure, markConnected, saveInstance, setHealth, setStatus, startPolling, stopPolling]);

  /* ── Refresh QR ── */
  const refreshQr = useCallback(async () => {
    const name = instanceName || getFixedInstanceName(consultantId);
    try {
      addLog("📱 Renovando QR Code...");
      const state = await checks.checkState(name);
      if (state === "open") {
        await markConnected(name, "✅ WhatsApp já está conectado!");
        startPolling(name);
        return;
      }
      const qrAttempt = await checks.tryGetQr(name);
      const recoveredConnection = qrAttempt.alreadyConnected || (
        !qrAttempt.qr && await checks.confirmConnectedState(name, 2, 1000)
      );
      if (recoveredConnection) {
        await markConnected(name, "✅ WhatsApp já está conectado!");
        startPolling(name);
        return;
      }
      if (qrAttempt.qr) {
        health.resetRecoveryCounter();
        setQrCode(qrAttempt.qr);
        setQrGeneratedAt(Date.now());
        setStatus("connecting");
        setHealth("needs_qr");
        setError(null);
        addLog("📱 Novo QR Code gerado");
      } else {
        addLog("⏳ QR Code ainda não disponível. Tentando novamente...");
      }
    } catch (err) {
      if (isAuthError(err)) { handleAuthFailure(err); return; }
      console.warn("[useWhatsApp] refreshQr error:", err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceName, consultantId, addLog, handleAuthFailure, markConnected, setHealth, setStatus, startPolling]);

  /* ── Disconnect ── */
  const disconnect = useCallback(async () => {
    const name = instanceName || getFixedInstanceName(consultantId);
    setIsLoading(true);
    stopPolling();

    try {
      try { await withTimeout(logoutInstance(name), 15000); } catch { /* ok */ }
      await deleteInstanceDb();

      setStatus("disconnected");
      setHasInstance(false);
      setInstanceName(null);
      setQrCode(null);
      setQrGeneratedAt(null);
      setPhoneNumber(null);
      setError(null);
      setHealth("healthy");
      health.resetRecoveryCounter();
      instanceSavedRef.current = false;
      timeoutCountRef.current = 0;
      setConsecutiveTimeouts(0);
      addLog("✅ Desconectado");
    } catch (err) {
      addLog("❌ " + sanitize(err instanceof Error ? err.message : "Erro"));
    } finally {
      setIsLoading(false);
      lockRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceName, consultantId, stopPolling, addLog, deleteInstanceDb, setHealth, setStatus]);

  /* ── Level 3: Safe Reset ── */
  const safeReset = useCallback(async () => {
    if (lockRef.current) return;
    lockRef.current = true;

    const name = instanceName || getFixedInstanceName(consultantId);
    setIsLoading(true);
    setHealth("resetting");
    stopPolling();

    addLog("🔄 Iniciando reset seguro da conexão...");

    try {
      addLog("1/4 — Encerrando sessão WhatsApp...");
      try { await withTimeout(logoutInstance(name), 10000); } catch { /* ok */ }
      await sleep(2000);

      addLog("2/4 — Removendo instância antiga...");
      try { await withTimeout(deleteInstance(name), 10000); } catch { /* ok */ }
      await sleep(2000);

      addLog("3/4 — Limpando registros locais...");
      await deleteInstanceDb();
      instanceSavedRef.current = false;
      health.resetRecoveryCounter();
      timeoutCountRef.current = 0;
      setConsecutiveTimeouts(0);

      addLog("4/4 — Criando nova instância...");
      setInstanceName(name);

      try {
        const response = await withTimeout(createInstance(name), 20000);
        await saveInstance(name);
        instanceSavedRef.current = true; setHasInstance(true);

        const qr = response?.qrcode?.base64 || null;
        if (qr) {
          health.resetRecoveryCounter();
          setQrCode(qr);
          setQrGeneratedAt(Date.now());
          setStatus("connecting");
          setHealth("needs_qr");
          addLog("✅ Reset concluído! Escaneie o novo QR Code.");
        } else {
          setStatus("connecting");
          setHealth("recovering");
          addLog("✅ Instância recriada. Aguardando QR Code...");
        }
        setError(null);
        startPolling(name);
      } catch (createErr) {
        if (isAuthError(createErr)) { handleAuthFailure(createErr); return; }

        const msg = sanitize(createErr instanceof Error ? createErr.message : "Erro");

        if (msg.includes("already") || msg.includes("exists") || msg.includes("403") || msg.includes("409")) {
          await saveInstance(name);
          instanceSavedRef.current = true; setHasInstance(true);
          setStatus("connecting");
          setHealth("recovering");
          addLog("⏳ Instância recuperada. Aguardando QR Code...");
          setError(null);
          startPolling(name);
          return;
        }

        setStatus("disconnected");
        setHealth("reset_recommended");
        setError("Falha ao recriar instância. Tente novamente em instantes.");
        addLog("❌ " + msg);
      }
    } catch (err) {
      if (isAuthError(err)) { handleAuthFailure(err); return; }
      const msg = sanitize(err instanceof Error ? err.message : "Erro no reset");
      setStatus("disconnected");
      setHealth("reset_recommended");
      setError(msg);
      addLog("❌ " + msg);
    } finally {
      lockRef.current = false;
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceName, consultantId, addLog, deleteInstanceDb, handleAuthFailure, saveInstance, setHealth, setStatus, startPolling, stopPolling]);

  const reconnect = useCallback(() => createAndConnect(), [createAndConnect]);

  /* ── On mount: check if already connected ── */
  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    // Guard: sem consultantId válido (UUID), não consulta nada.
    if (!consultantId) {
      setStatus("disconnected");
      setIsLoading(false);
      return () => {
        mountedRef.current = false;
        stopPolling();
      };
    }

    async function init() {
      const name = getFixedInstanceName(consultantId);
      setInstanceName(name);

      // ── WHAPI CHECK: Se este consultor é o super admin (usa Whapi), pular Evolution ──
      // Identificação primária: settings.superadmin_consultant_id (DB).
      // Identificação secundária: e-mail do auth (rafael.ids@icloud.com) —
      // garante que o super admin nunca caia no fluxo Evolution mesmo se a
      // tabela settings falhar em ler (RLS, timeout, primeira inicialização).
      let isSuperAdmin = false;
      try {
        const { data: settingsRows } = await supabase
          .from("settings")
          .select("key, value")
          .in("key", ["superadmin_consultant_id", "whapi_connected_phone"]);
        const settings: Record<string, string> = {};
        settingsRows?.forEach((s: any) => { settings[s.key] = s.value; });

        if (settings.superadmin_consultant_id === consultantId) {
          isSuperAdmin = true;
          setPhoneNumber(settings.whapi_connected_phone || "+55 11 99009-2401");
        }

        if (!isSuperAdmin) {
          // Fallback: checa e-mail da sessão atual contra o whitelist.
          const { data: { user } } = await supabase.auth.getUser();
          const email = user?.email?.toLowerCase().trim();
          if (email === "rafael.ids@icloud.com" && user?.id === consultantId) {
            isSuperAdmin = true;
            setPhoneNumber(settings.whapi_connected_phone || "+55 11 99009-2401");
            addLog("ℹ️ Super admin reconhecido via e-mail (settings indisponíveis)");
          }
        }

        if (isSuperAdmin) {
          setIsWhapi(true);
          setHasInstance(true);
          setStatus("connected");
          setError(null);
          setIsLoading(false);
          addLog("✅ Conectado via Whapi Cloud (Super Admin)");
          setHealth("healthy");
          return;
        }
      } catch (e) {
        // Falha na leitura de settings — checa só pelo e-mail antes de cair no Evolution.
        try {
          const { data: { user } } = await supabase.auth.getUser();
          const email = user?.email?.toLowerCase().trim();
          if (email === "rafael.ids@icloud.com" && user?.id === consultantId) {
            setIsWhapi(true);
            setHasInstance(true);
            setStatus("connected");
            setPhoneNumber("+55 11 99009-2401");
            setError(null);
            setIsLoading(false);
            addLog("✅ Conectado via Whapi Cloud (Super Admin, fallback e-mail)");
            setHealth("healthy");
            return;
          }
        } catch (_) { /* segue para Evolution normalmente */ }
      }

      try {
        const { data: instanceRecord } = await supabase
          .from("whatsapp_instances")
          .select("id")
          .eq("consultant_id", consultantId)
          .maybeSingle();

        if (cancelled) return;

        if (!instanceRecord) {
          setHasInstance(false);
          setStatus("disconnected");
          setError(null);
          setIsLoading(false);
          return;
        }
        setHasInstance(true);

        const state = await withTimeout(checks.checkState(name), 15000);
        if (cancelled) return;

        if (state === "open") {
          await markConnected(name, "✅ WhatsApp conectado!");
          startPolling(name);
          setIsLoading(false);
          return;
        }

        if (state === "connecting") {
          setStatus("connecting");
          setHealth("recovering");
          addLog("⏳ Recuperando conexão...");
          startPolling(name);
          setIsLoading(false);
          return;
        }

        if (state === "unknown") {
          addLog("⚠️ Servidor lento. Tentando recuperar...");
          setHealth("degraded");
          setStatus("connecting");
          startPolling(name);
          setIsLoading(false);
          return;
        }

        setStatus("disconnected");
        setError(null);
        setIsLoading(false);
        return;
      } catch (err) {
        if (!cancelled && isAuthError(err)) {
          handleAuthFailure(err);
          setIsLoading(false);
          return;
        }
      }

      if (cancelled) return;
      setStatus("disconnected");
      setError(null);
      setIsLoading(false);
    }

    void init();

    return () => {
      cancelled = true;
      mountedRef.current = false;
      stopPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consultantId]);

  return {
    connectionStatus,
    instanceName,
    qrCode,
    qrGeneratedAt,
    phoneNumber,
    isLoading,
    error,
    connectionLog,
    operationalHealth,
    consecutiveTimeouts,
    isWhapi,
    hasInstance,
    createAndConnect,
    disconnect,
    reconnect,
    refreshQr,
    safeReset,
  };
}