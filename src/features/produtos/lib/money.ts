// =============================================================================
// Helper de dinheiro — valores monetários em centavos
// =============================================================================
//
// Convenção do módulo (ver design.md, seção "Valores monetários em centavos"):
// - Armazenar/transportar: sempre inteiro em centavos (`*_cents`).
// - Calcular: tudo em centavos; arredondar só no fim.
// - Exibir: usar `formatBRLFromCents` na camada de apresentação.
// - Entrada do usuário: ao digitar reais, converter com `reaisToCents` ao salvar.

/**
 * Formata um valor em centavos como moeda brasileira (R$).
 *
 * Exemplo: `formatBRLFromCents(5490)` → "R$ 54,90".
 *
 * @param cents valor inteiro em centavos
 * @returns string formatada em pt-BR no estilo de moeda BRL
 */
export function formatBRLFromCents(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

/**
 * Converte um valor em reais (com casas decimais) para centavos inteiros.
 *
 * Arredonda para o centavo mais próximo para evitar erros de ponto flutuante.
 * Exemplo: `reaisToCents(54.9)` → 5490.
 *
 * @param reais valor em reais (pode ter centavos fracionários)
 * @returns valor inteiro em centavos
 */
export function reaisToCents(reais: number): number {
  return Math.round(reais * 100);
}

/**
 * Converte um valor em centavos para reais (número com casas decimais).
 *
 * Útil para cálculos que precisam exibir o valor numérico em reais.
 * Exemplo: `centsToReais(5490)` → 54.9.
 *
 * @param cents valor inteiro em centavos
 * @returns valor em reais
 */
export function centsToReais(cents: number): number {
  return cents / 100;
}
