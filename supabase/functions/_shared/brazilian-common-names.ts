/**
 * Top prenomes BR (uso frequente) para pré-aquecer áudio Sofia (Olá/Então + nome).
 * 100 masculinos + 100 femininos. Gênero na hora = inferSpeechGender.
 */

export const COMMON_MASCULINE_FIRST_NAMES: string[] = [
  "José", "João", "Antonio", "Francisco", "Carlos", "Paulo", "Pedro", "Lucas",
  "Luiz", "Marcos", "Luis", "Gabriel", "Rafael", "Daniel", "Marcelo", "Bruno",
  "Eduardo", "Felipe", "Rodrigo", "André", "Fábio", "Leonardo", "Gustavo",
  "Guilherme", "Ricardo", "Roberto", "Diego", "Thiago", "Tiago", "Matheus",
  "Mateus", "Vinicius", "Vitor", "Victor", "Alexandre", "Anderson", "Arthur",
  "Artur", "Bernardo", "Caio", "Cesar", "Claudio", "Cristiano", "David",
  "Douglas", "Edson", "Elias", "Emerson", "Enrico", "Enzo", "Eric", "Everton",
  "Fabiano", "Fernando", "Flavio", "Geraldo", "Gilberto", "Heitor", "Henrique",
  "Hugo", "Igor", "Ivan", "Jefferson", "Jorge", "Julio", "Kevin", "Leandro",
  "Lorenzo", "Luciano", "Maicon", "Manoel", "Mario", "Mauricio", "Miguel",
  "Murilo", "Nelson", "Nicolas", "Otavio", "Patrick", "Raul", "Renan", "Renato",
  "Rogerio", "Romulo", "Ronaldo", "Samuel", "Sandro", "Sergio", "Silvio",
  "Tadeu", "Theo", "Wagner", "Wallace", "Walter", "Wellington", "Wesley",
  "William", "Wilson", "Yuri", "Adriano",
];

export const COMMON_FEMININE_FIRST_NAMES: string[] = [
  "Maria", "Ana", "Francisca", "Antonia", "Adriana", "Juliana", "Marcia",
  "Fernanda", "Patricia", "Aline", "Sandra", "Camila", "Amanda", "Bruna",
  "Jessica", "Leticia", "Julia", "Luciana", "Vanessa", "Mariana", "Gabriela",
  "Paula", "Carla", "Daniela", "Rafaela", "Simone", "Andreia", "Cristina",
  "Renata", "Beatriz", "Larissa", "Carolina", "Claudia", "Lucia", "Rita",
  "Rosa", "Aparecida", "Sonia", "Vera", "Marta", "Helena", "Eliane", "Denise",
  "Monica", "Alice", "Bianca", "Isabela", "Isabella", "Natalia", "Priscila",
  "Roberta", "Sabrina", "Tatiana", "Thais", "Valeria", "Vitoria", "Viviane",
  "Yasmin", "Angela", "Barbara", "Cecilia", "Clara", "Debora", "Eduarda",
  "Elaine", "Fabiana", "Fatima", "Flavia", "Giovana", "Giovanna", "Ingrid",
  "Irene", "Ivone", "Joana", "Joyce", "Katia", "Kelly", "Laura", "Leila",
  "Lorena", "Luana", "Luiza", "Manuela", "Marcela", "Marina", "Marlene",
  "Michele", "Michelle", "Nicole", "Olivia", "Raquel", "Regina", "Rosana",
  "Samara", "Silvia", "Sirlene", "Solange", "Sueli", "Talita", "Tania",
];

/** Nomes inválidos / ruído que não devem gerar TTS. */
export const NAME_PREWARM_STOPWORDS = new Set([
  "cliente", "teste", "empresa", "deus", "meus", "tenho", "uma", "de", "da", "do",
  "responsavel", "igreja", "oliveira", "soares", "nobre", "panificadora",
  "prospera", "usimix", "ozonteck", "ixi", "bell", "laah", "godoy", "sabor",
  "salute", "morvanamaral", "renilsonferreiralima",
]);

export function mergePrewarmNames(extra: string[] = []): string[] {
  const all = [
    ...COMMON_MASCULINE_FIRST_NAMES,
    ...COMMON_FEMININE_FIRST_NAMES,
    ...extra,
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of all) {
    const part = String(raw || "").trim().split(/\s+/)[0] || "";
    if (part.length < 2 || part.length > 20) continue;
    const key = part
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z]/g, "");
    if (!key || NAME_PREWARM_STOPWORDS.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(part.charAt(0).toUpperCase() + part.slice(1).toLowerCase());
  }
  return out;
}
