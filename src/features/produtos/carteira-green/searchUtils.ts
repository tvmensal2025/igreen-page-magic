// Normaliza strings para busca insensível a acentos e caixa.
export function norm(s: string | null | undefined): string {
  return String(s || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}
