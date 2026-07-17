/**
 * Infere gênero gramatical (masculino/feminino) a partir do primeiro nome.
 * Usado em áudio WA (bem-vindo/bem-vinda) e textos com {{bem_vindo}}.
 *
 * Ordem: lista F → lista M → sufixos tipicamente F no BR → termina em "a" → default M.
 * Nomes como Sirlene/Marlene/Irene NÃO podem cair no default masculino.
 */

export type SpeechGender = "masculino" | "feminino";

function normalizeFirstName(raw: string): string {
  return (raw || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .split(/\s+/)[0]
    ?.replace(/[^a-z]/g, "") || "";
}

/** Nomes masculinos que terminam em "a" (exceção à heurística). */
const MASCULINE_ENDING_A = new Set([
  "luca",
  "nicola",
  "joshua",
  "noa",
  "toba",
  "juda",
]);

/**
 * Sufixos femininos comuns no BR (após normalizar acentos).
 * Ex.: Sirlene, Marlene, Irene, Aline, Clarice, Michelle.
 * Só aplica se o nome NÃO estiver na lista masculina.
 */
const FEMININE_SUFFIXES = [
  "lene",
  "rene",
  "sene",
  "tene",
  "dene",
  "ene",
  "iane",
  "aine",
  "eine",
  "oine",
  "uine",
  "ine",
  "elle",
  "ette",
  "isse",
  "ice",
  "yse",
  "aise",
] as const;

/** Lista de nomes femininos comuns (inclui ambíguos resolvidos). */
const FEMININE_NAMES = new Set([
  "maria", "ana", "julia", "juliana", "fernanda", "patricia",
  "amanda", "bruna", "camila", "carla", "carolina", "claudia", "cristina",
  "daniela", "debora", "eduarda", "eliane", "fabiana", "flavia", "gabriela",
  "giovana", "giovanna", "helena", "isabela", "isabella", "jessica", "joana",
  "larissa", "leticia", "lilian", "luciana", "luiza", "manuela", "marcela",
  "mariana", "marta", "michelle", "monica", "natalia", "paula", "priscila",
  "rafaela", "renata", "roberta", "sandra", "sara", "silvia", "sofia", "sonia",
  "stephanie", "suzana", "talita", "tatiana", "thais", "valeria", "vanessa",
  "vera", "vitoria", "viviane", "yasmin", "alice", "beatriz", "bianca",
  "cecilia", "clara", "elaine", "ester", "eva", "iris", "isis", "laura",
  "lia", "lorena", "luana", "maya", "melissa", "nicole", "olivia",
  "rebeca", "rita", "rosa", "sabrina", "samara", "simone", "telma", "teresa",
  "adriana", "aline", "andreia", "angela", "aparecida", "barbara",
  "benedita", "carmen", "celia", "cintia", "denise", "diana",
  "elisa", "eliza", "emilia", "erica", "erika", "fabiola", "fatima",
  "francisca", "gisele", "gloria", "graciele", "ingrid", "irene", "ivone",
  "jacira", "janaina", "joice", "joyce", "katia", "kelly", "keila", "leila",
  "lidia", "ligia", "lourdes", "lucia", "luciene", "madalena", "magali",
  "marcia", "margarida", "marina", "michele", "mirela", "nair", "neide",
  "neusa", "nilce", "norma", "oneide", "poliana", "raquel",
  "regina", "rosana", "rosangela", "rose", "roseli", "salete", "selma",
  "shirley", "silvana", "solange", "sueli", "tania", "tereza", "valentina",
  "vania", "veronica", "vilma", "waleria", "zelia",
  // -ene / -ine que antes caíam no default masculino
  "sirlene", "marlene", "darlene", "arlene", "helene", "irene", "nene",
  "juraci", "jucelia", "neidinha", "cicera", "conceicao", "fatima",
  "rosimeire", "rosemary", "rosemeire", "edileuza", "edilene", "neide",
  "clair", "claire", "mabel", "micheli", "nathalie", "nathaly", "nathalia",
  "rayane", "rayssa", "raissa", "lais", "laís", "tais", "taís",
  "kerolaine", "kerolen", "caroline", "caroliny", "jennyfer", "jennifer",
  "andressa", "jaiara", "jaqueline", "jackeline", "jacqueline",
  "suelen", "suelen", "suelene", "sueli", "suely", "scheila", "sheila",
  "taina", "tainara", "tayane", "tayná", "tayna", "vivian", "viviane",
  "wanessa", "wanda", "zeni", "zilda", "zuleica", "zuleide",
]);

/** Lista de nomes masculinos comuns. */
const MASCULINE_NAMES = new Set([
  "jose", "joao", "antonio", "francisco", "carlos", "paulo", "pedro", "lucas",
  "luiz", "marcos", "luis", "gabriel", "rafael", "daniel", "marcelo", "bruno",
  "eduardo", "felipe", "rodrigo", "andre", "fabio", "leonardo", "gustavo",
  "guilherme", "ricardo", "roberto", "diego", "thiago", "tiago", "matheus",
  "mateus", "vinicius", "vitor", "victor", "alexandre", "anderson", "arthur",
  "artur", "bernardo", "caio", "cesar", "claudio", "cristiano", "david",
  "douglas", "edson", "elias", "emerson", "enrico", "enzo", "eric", "everton",
  "fabiano", "fernando", "flavio", "geraldo", "gilberto", "heitor",
  "henrique", "hugo", "igor", "ivan", "jefferson", "jorge", "julio", "kevin",
  "leandro", "lorenzo", "luciano", "maicon", "manoel", "mario",
  "mauricio", "miguel", "murilo", "nelson", "nicholas", "nicolas", "nilton",
  "otavio", "patrick", "raul", "renan", "renato",
  "rogerio", "romulo", "ronaldo", "samuel", "sandro", "sergio", "sidnei",
  "silvio", "tadeu", "theo", "thomas", "tomaz", "valter", "wagner", "wallace",
  "walter", "washington", "wellington", "wesley", "william", "wilson", "yago",
  "yan", "yuri", "adriano", "alan", "alberto", "alex", "alvaro", "amilcar",
  "angelo", "benicio", "benjamin", "calebe", "dani", "danilo", "davi", "denis",
  "eder", "edison", "edu", "egidio", "elton", "erick", "evaldo", "ezequiel",
  "fabricio", "fausto", "felix", "fred", "frederico", "gil", "gilmar",
  "giovanni", "helio", "hercules", "hilario", "ibrahim", "inacio",
  "isaac", "israel", "italo", "ivo", "jackson", "jacson", "jaime", "jair",
  "james", "janio", "jason", "jonas", "jonathan", "jordan", "josue",
  "juan", "junior", "kaique", "kaua", "kleber", "laercio", "lauro",
  "lazaro", "leo", "levi", "lincoln", "lisandro", "lourenco",
  "luca", "lucio", "luigi", "manolo", "marcio", "martim", "martin", "max",
  "michel", "moises", "natan", "nathan", "neil", "newton", "nilson", "nilo",
  "norberto", "octavio", "omar", "orlando", "osmar", "osvaldo", "pablo",
  "pascoal", "pietro", "rafa", "ramon", "reginaldo",
  "reinaldo", "rene", "richard", "robert", "robin", "rocco", "rodolfo",
  "roger", "romeu", "rubens", "rui", "ryan", "salvador", "santiago",
  "saulo", "sebastiao", "severino", "simon", "stefan", "steve", "sullivan",
  "talles", "teodoro", "tito", "tony", "ulisses", "vanderlei",
  "vicente", "vinicio", "virgilio", "waldir", "wanderson", "willian",
]);

function hasFeminineSuffix(n: string): boolean {
  return FEMININE_SUFFIXES.some((sfx) => n.length > sfx.length && n.endsWith(sfx));
}

/**
 * Infere gênero para concordância (bem-vindo / bem-vinda).
 */
export function inferSpeechGender(rawName: string | null | undefined): SpeechGender {
  const n = normalizeFirstName(String(rawName || ""));
  if (!n) return "masculino";
  if (FEMININE_NAMES.has(n)) return "feminino";
  if (MASCULINE_NAMES.has(n)) return "masculino";
  if (n.endsWith("a") && !MASCULINE_ENDING_A.has(n)) return "feminino";
  // Sirlene, Marlene, Aline, Clarice, etc. — antes iam para masculino por default
  if (hasFeminineSuffix(n)) return "feminino";
  return "masculino";
}

export function firstNameDisplay(raw: string | null | undefined): string {
  const part = String(raw || "").trim().split(/\s+/)[0]?.replace(/[.,;:!?]+$/g, "") || "";
  if (!part) return "";
  return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
}
