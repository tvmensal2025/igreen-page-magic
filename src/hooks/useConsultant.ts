import { useQuery } from "@tanstack/react-query";
import type { Consultant } from "@/types/consultant";
import { resolvePublicConsultant } from "@/lib/resolvePublicConsultant";

/**
 * Resolve consultor público pela licença da URL.
 * Todo consultor com `license` preenchida é público (não depende de approved).
 */
export function useConsultant(license: string) {
  return useQuery<Consultant | null>({
    queryKey: ["consultant", license],
    queryFn: async () => {
      const resolved = await resolvePublicConsultant(license);
      return resolved?.consultant ?? null;
    },
    enabled: !!license,
  });
}
