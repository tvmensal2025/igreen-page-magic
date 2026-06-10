/**
 * Repassador do pipeline de cadastro do Cérebro IA (pt-BR) — Tarefa 11.1.
 *
 * Spec: `.kiro/specs/cerebro-ia/design.md` — seções "Pipeline de cadastro
 * (mídia, OCR, OTP, portal)" e "Não quebrar o worker do portal".
 * Requisitos: 16.1 e 16.3 (não-regressão do worker/roteamento).
 *
 * POR QUE ESTA PEÇA EXISTE
 * ------------------------
 * O Cérebro DECIDE o QUANDO (qual passo) — o helper e o worker decidem o COMO
 * (despacho, roteamento, payload). A peça N3 (`decisor-passo.ts`) apenas EXPÕE
 * a `DeferredAction` de cadastro em `acaoCadastro`; a N1 (`index.ts`) apenas a
 * COMPÕE no `ResultadoCerebro`. Nenhuma das duas executa nada.
 *
 * Faltava o ELO FINAL, e este arquivo é só isso: o ponto ÚNICO e testável que
 * transforma a `acaoCadastro` decidida pelo Cérebro numa execução real do
 * cadastro. A regra de ouro (design — "Despacho único pelo helper existente"):
 *
 *   ▸ Para `portal_submit` (passo `cadastro_portal`/`finalizar_cadastro`) o
 *     ÚNICO caminho permitido é `dispatchPortalWorker(supabase, customerId)`.
 *     O Cérebro NUNCA monta payload de portal nem chama o worker direto — quem
 *     decide worker (digital × autoconexao), monta payload e aplica o gate de
 *     documentos é o próprio `dispatchPortalWorker`/`portal-worker.ts`.
 *
 *   ▸ Para `ocr` e `otp_submit` este repassador NÃO faz nada de portal: essas
 *     ações pertencem ao dispatcher existente (`_shared/dispatcher/` + hooks de
 *     OCR) e à interceptação de OTP (`otp-intercept` + `submit-otp`), que ficam
 *     FORA do Cérebro (Tarefa 11.4). Aqui elas são apenas roteadas como
 *     "delegar ao caminho existente", sem tocar no worker do portal.
 *
 * Em uma frase: nada de `portal-worker.ts` é reescrito; o Cérebro só REÚSA o
 * helper, por um único ponto, comprovável por teste-guardião.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { dispatchPortalWorker } from "../portal-worker.ts";
import type { DispatchResult } from "../portal-worker.ts";
import type { AcaoCadastroDeferida } from "./tipos.ts";

// deno-lint-ignore no-explicit-any
type AnySupabase = any;

/**
 * Para onde a `acaoCadastro` foi roteada por este repassador:
 *   - `portal_worker`        → acionou `dispatchPortalWorker` (e só ele);
 *   - `dispatcher_existente` → ação `ocr` delegada ao dispatcher existente;
 *   - `otp_intercept`        → ação `otp_submit` pertence ao `otp-intercept`.
 * Em todos os casos que NÃO são portal, o worker do portal NÃO é tocado.
 */
export type DestinoDespacho =
  | "portal_worker"
  | "dispatcher_existente"
  | "otp_intercept";

/** Resultado observável do repasse (para auditoria/teste; nunca lança). */
export interface ResultadoDespachoCadastro {
  /** Tipo da ação de cadastro repassada. */
  kind: AcaoCadastroDeferida["kind"];
  /** Para onde foi roteada. */
  destino: DestinoDespacho;
  /** `true` apenas quando `dispatchPortalWorker` foi de fato acionado. */
  acionouPortalWorker: boolean;
  /** Resultado do helper de portal, quando aplicável (`portal_submit`). */
  resultadoPortal?: DispatchResult;
}

/**
 * Dependências injetáveis (para teste isolado, sem rede). Em produção usa-se a
 * implementação real importada de `portal-worker.ts`. Note que NÃO há ponto de
 * injeção para "montar payload" nem "chamar worker direto": por construção, o
 * único efeito de portal possível é via `dispatchPortalWorker`.
 */
export interface DependenciasDespachoCadastro {
  dispatchPortalWorker?: typeof dispatchPortalWorker;
}

/** Entrada do repassador do pipeline de cadastro. */
export interface EntradaDespachoCadastro {
  supabase: SupabaseClient | AnySupabase;
  customerId: string;
  /** A ação de cadastro EXPOSTA pelo Cérebro (N3 → N1), repassada sem reescrever. */
  acaoCadastro: AcaoCadastroDeferida;
  deps?: DependenciasDespachoCadastro;
}

/**
 * Repassa a `acaoCadastro` decidida pelo Cérebro para o caminho de execução
 * EXISTENTE — ponto ÚNICO do Cérebro para o pipeline de cadastro.
 *
 * INVARIANTE (Requisito 16.1, 16.3): a ação `portal_submit` SÓ pode acionar
 * `dispatchPortalWorker`. Este é o único lugar do Cérebro que executa cadastro,
 * e ele não tem como montar payload nem chamar o worker direto — só repassa o
 * `customerId` ao helper, que cuida do roteamento (digital × autoconexao), do
 * payload e do gate de documentos do Portal 2.
 *
 * Best-effort: nunca lança. Uma falha de despacho não pode derrubar o turno do
 * Cérebro (mesmo espírito fail-open de `processarTurno`).
 *
 * @returns Para onde a ação foi roteada e se o worker do portal foi acionado.
 */
export async function despacharAcaoCadastro(
  entrada: EntradaDespachoCadastro,
): Promise<ResultadoDespachoCadastro> {
  const { supabase, customerId, acaoCadastro } = entrada;
  const dispatch = entrada.deps?.dispatchPortalWorker ?? dispatchPortalWorker;

  switch (acaoCadastro.kind) {
    case "portal_submit": {
      // ÚNICO caminho permitido para o portal (design — "Despacho único pelo
      // helper existente"). Sem montar payload, sem escolher worker, sem fetch:
      // tudo isso é responsabilidade de `dispatchPortalWorker`/portal-worker.ts.
      try {
        const resultadoPortal = await dispatch(supabase, customerId);
        return {
          kind: "portal_submit",
          destino: "portal_worker",
          acionouPortalWorker: true,
          resultadoPortal,
        };
      } catch (e) {
        // Fail-open: erro no despacho do portal não derruba o turno do Cérebro.
        console.warn(
          "[cerebro/despacho-cadastro] dispatchPortalWorker falhou (fail-open):",
          (e as { message?: string })?.message,
        );
        return {
          kind: "portal_submit",
          destino: "portal_worker",
          acionouPortalWorker: true,
        };
      }
    }

    case "ocr": {
      // OCR é tratado pelo dispatcher existente (`_shared/dispatcher/` + hooks),
      // exatamente como no caminho do engine v3. O Cérebro só sinaliza; aqui
      // NÃO se toca no worker do portal (Tarefa 11.4).
      return {
        kind: "ocr",
        destino: "dispatcher_existente",
        acionouPortalWorker: false,
      };
    }

    case "otp_submit": {
      // OTP é interceptado ANTES do Cérebro (`otp-intercept` + `submit-otp`).
      // Por completude o repassador reconhece a ação, mas NÃO toca no worker do
      // portal (Tarefa 11.4).
      return {
        kind: "otp_submit",
        destino: "otp_intercept",
        acionouPortalWorker: false,
      };
    }
  }
}
