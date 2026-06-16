// =============================================================================
// Orçamento — Hooks (React Query)
// =============================================================================
// Consumo das propostas na UI do consultor. Mutations invalidam a lista do
// consultor para manter painel/board sincronizados. Padrão idêntico ao resto
// do projeto (vendas/hooks.ts, catalogo/hooks.ts).
// =============================================================================

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  consultantReplyToCounter,
  createProposal,
  deleteProposal,
  expireOverdueProposals,
  fetchProposalEvents,
  fetchProposals,
} from "./api";
import type { CreateProposalInput, Proposal, ProposalEvent } from "./types";

const PROPOSALS_KEY = "proposals";

/** Lista as propostas de um consultor (expira vencidas antes de buscar). */
export function useProposals(consultantId: string | undefined) {
  return useQuery<Proposal[]>({
    queryKey: [PROPOSALS_KEY, consultantId],
    queryFn: async () => {
      await expireOverdueProposals().catch(() => {});
      return fetchProposals(consultantId as string);
    },
    enabled: !!consultantId,
  });
}

/** Lê o histórico/rodadas de uma proposta. */
export function useProposalEvents(proposalId: string | undefined) {
  return useQuery<ProposalEvent[]>({
    queryKey: [PROPOSALS_KEY, "events", proposalId],
    queryFn: () => fetchProposalEvents(proposalId as string),
    enabled: !!proposalId,
  });
}

/** Cria uma proposta e invalida a lista do consultor. */
export function useCreateProposal(consultantId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProposalInput) => createProposal(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [PROPOSALS_KEY, consultantId] });
    },
  });
}

/** Consultor responde a uma contraproposta (nova rodada). */
export function useReplyToCounter(consultantId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      proposalId,
      patch,
    }: {
      proposalId: string;
      patch: { amountCents?: number; message?: string | null; note?: string | null };
    }) => consultantReplyToCounter(proposalId, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [PROPOSALS_KEY, consultantId] });
    },
  });
}

/** Remove uma proposta. */
export function useDeleteProposal(consultantId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (proposalId: string) => deleteProposal(proposalId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [PROPOSALS_KEY, consultantId] });
    },
  });
}
