// Presets de distribuidoras para campanhas Facebook Ads.
// Baseado na tabela de Bônus Extra iGreen (Maio 2026) — Conexão Green.
// Cada preset traz cidades-chave (capital + interior relevante) que serão
// resolvidas via Marketing API (/search) na hora de adicionar à campanha.

export interface DistribuidoraPreset {
  id: string;
  nome: string;        // Ex: "CPFL Paulista"
  uf: string;          // Ex: "SP"
  bonusMax: number;    // Ex: 100 (até 100% de bônus extra)
  bonusLabel: string;  // Ex: "50% + 50%"
  tier: "alto" | "medio" | "sem_bonus";
  cidades: string[];   // Cidades-chave para anúncio
}

export const DISTRIBUIDORAS_PRESETS: DistribuidoraPreset[] = [
  // ===== TIER ALTO (até 100% bônus) =====
  {
    id: "cpfl-paulista",
    nome: "CPFL Paulista",
    uf: "SP",
    bonusMax: 100,
    bonusLabel: "50% + 50%",
    tier: "alto",
    // Concessão CPFL Paulista (NÃO inclui Sorocaba/Jundiaí — essas são CPFL Piratininga).
    cidades: [
      "Campinas", "Ribeirão Preto", "Bauru", "Piracicaba", "Limeira", "Americana",
      "Araraquara", "São Carlos", "Franca", "Marília", "Presidente Prudente",
      "São José do Rio Preto", "Rio Claro", "Santa Bárbara d'Oeste", "Nova Odessa",
      "Hortolândia", "Paulínia", "Sumaré", "Cosmópolis", "Jaguariúna", "Pedreira",
      "Amparo", "Mogi Guaçu", "Mogi Mirim", "Itapira", "Capivari", "Elias Fausto",
      "Monte Mor", "Rafard", "Mombuca", "Tietê", "Cerquilho", "Boituva", "Jaú",
      "Lençóis Paulista", "Botucatu", "Lins", "Penápolis", "Birigui", "Araçatuba",
      "Catanduva", "Jaboticabal", "Sertãozinho", "Barretos", "Bebedouro", "Matão",
      "Ibitinga", "Pirassununga", "Leme", "Araras", "Conchal", "Engenheiro Coelho",
      "Mococa", "São João da Boa Vista", "Espírito Santo do Pinhal", "Santo Antônio do Jardim",
      "Aguaí", "Vargem Grande do Sul", "Casa Branca", "Tambaú", "Santa Cruz das Palmeiras",
      "Porto Ferreira", "Descalvado", "Ibaté", "Ribeirão Bonito", "Boa Esperança do Sul",
      "Tabatinga", "Itápolis", "Borborema", "Novo Horizonte", "Itajobi", "Pindorama",
      "Cajobi", "Severínia", "Olímpia", "Guaraci", "Colina", "Colômbia", "Guaíra",
      "Jaborandi", "Morro Agudo", "Orlândia", "Sales Oliveira", "Igarapava",
      "Ituverava", "Miguelópolis", "Aramina", "Buritizal", "São Joaquim da Barra",
      "Cravinhos", "Serrana", "Sertãozinho", "Pontal", "Pradópolis", "Pitangueiras",
      "Taquaritinga", "Cândido Rodrigues", "Itápolis", "Tabapuã", "Catiguá",
      "Brodowski", "Batatais", "Altinópolis", "Cajuru", "Santa Rosa de Viterbo",
      "Santo Antônio da Alegria", "Patrocínio Paulista", "Pedregulho", "Restinga",
      "Rifaina", "Cristais Paulista", "Itirapuã", "Ipuã", "Ribeirão Corrente",
      "Pirangi", "Paraíso", "Embaúba", "Pirajuí", "Piratininga", "Agudos",
      "Iacanga", "Pederneiras", "Macatuba", "Areiópolis", "Borebi", "Avaí",
      "Cabrália Paulista", "Duartina", "Ubirajara", "Fernão", "Santa Maria da Serra",
      "Anhembi", "Bofete", "Conchas", "Pereiras", "Porangaba", "Torre de Pedra",
      "São Manuel", "Pratânia", "Itatinga", "Avaré", "Itaí", "Paranapanema",
      "Cerqueira César", "Águas de Santa Bárbara", "Iaras", "Manduri",
      "Pratania", "Bariri", "Itapuí", "Dois Córregos", "Mineiros do Tietê",
      "Brotas", "Torrinha", "Itirapina", "Charqueada", "Santa Maria da Serra",
      "Saltinho", "Rio das Pedras", "Santa Gertrudes", "Cordeirópolis",
      "Iracemápolis", "Holambra", "Artur Nogueira", "Mogi Guaçu", "Estiva Gerbi",
      "Santo Antônio de Posse", "Águas de Lindoia", "Lindóia", "Serra Negra",
      "Socorro", "Monte Sião", "Bragança Paulista", "Pedra Bela", "Pinhalzinho",
      "Tuiuti", "Valinhos", "Vinhedo", "Adamantina", "Lucélia", "Tupã",
      "Osvaldo Cruz", "Rancharia", "Martinópolis", "Álvares Machado", "Regente Feijó",
      "Pirapozinho", "Indiana", "Anhumas", "Caiabu", "Pres. Bernardes",
      "Santo Anastácio", "Junqueirópolis", "Dracena", "Panorama", "Mirandópolis",
      "Andradina", "Castilho", "Pereira Barreto", "Ilha Solteira", "Itapura",
      "Nova Independência", "Murutinga do Sul", "Sud Mennucci", "Buritama",
      "Coroados", "Glicério", "Bilac", "Promissão", "Guararapes", "Valparaíso",
      "Lavínia", "Mirassol", "Nova Granada", "Tanabi", "Bálsamo", "Cedral",
      "Onda Verde", "Icém", "Palestina", "Nhandeara", "General Salgado",
      "Magda", "Auriflama", "Floreal", "Votuporanga", "Fernandópolis",
      "Jales", "Santa Fé do Sul", "Jaboticabal", "Monte Alto", "Vista Alegre do Alto",
    ],
  },
  // ⚠️ CPFL Piratininga separada propositalmente — NÃO faz parte do bônus 100%.
  // Mantida em tier "sem_bonus" pra evitar mistura com cidades 100%.
  {
    id: "cpfl-piratininga",
    nome: "CPFL Piratininga",
    uf: "SP",
    bonusMax: 0,
    bonusLabel: "Sem bônus extra",
    tier: "sem_bonus",
    // Concessão CPFL Piratininga — Sorocaba, Jundiaí, Santos, baixada e região.
    cidades: [
      "Sorocaba", "Jundiaí", "Indaiatuba", "Itu", "Salto", "Atibaia",
      "Bragança Paulista", "Itapetininga", "Tatuí", "Várzea Paulista",
      "Campo Limpo Paulista", "Itupeva", "Louveira", "Santos", "São Vicente",
      "Praia Grande", "Cubatão", "Guarujá", "Bertioga", "Mongaguá", "Itanhaém",
      "Peruíbe", "Iperó", "Araçoiaba da Serra", "Votorantim", "Mairinque",
      "Alumínio", "Salto de Pirapora", "Piedade", "Pilar do Sul", "Capela do Alto",
      "Cesário Lange", "Quadra", "Porangaba", "Torre de Pedra", "São Miguel Arcanjo",
      "Tapiraí", "Juquiá", "Miracatu", "Pedro de Toledo", "Itariri",
      "Jarinu", "Vargem", "Pinhalzinho", "Joanópolis", "Piracaia", "Bom Jesus dos Perdões",
      "Nazaré Paulista", "Itatiba", "Morungaba", "Tuiuti", "Pedra Bela",
      "Capão Bonito", "Buri", "Itapeva", "Itararé", "Apiaí",
    ],
  },
  {
    id: "copel-pr",
    nome: "Copel",
    uf: "PR",
    bonusMax: 100,
    bonusLabel: "50% + 50%",
    tier: "alto",
    cidades: [
      "Curitiba", "Londrina", "Maringá", "Ponta Grossa", "Cascavel", "São José dos Pinhais",
      "Foz do Iguaçu", "Guarapuava", "Apucarana", "Toledo", "Paranaguá", "Araucária",
      "Pinhais", "Colombo", "Campo Largo", "Almirante Tamandaré", "Piraquara",
      "Fazenda Rio Grande", "Campo Magro", "Quatro Barras", "Campina Grande do Sul",
      "Paranavaí", "Umuarama", "Arapongas", "Cambé", "Rolândia", "Sarandi",
      "Pato Branco", "Francisco Beltrão", "Telêmaco Borba", "União da Vitória",
      "Castro", "Irati", "Cornélio Procópio", "Jacarezinho", "Ibiporã",
      "Cianorte", "Campo Mourão", "Ivaiporã", "Marechal Cândido Rondon",
      "Medianeira", "Palotina", "Loanda", "Santo Antônio da Platina",
      "Bandeirantes", "Wenceslau Braz", "Siqueira Campos", "Lapa", "Rio Negro",
      "São Mateus do Sul", "Prudentópolis", "Reserva", "Tibagi", "Imbituva",
      "Mandaguari", "Astorga", "Jandaia do Sul", "Faxinal", "Manoel Ribas",
    ],
  },
  {
    id: "cemig-mg",
    nome: "Cemig",
    uf: "MG",
    bonusMax: 100,
    bonusLabel: "50% + 50%",
    tier: "alto",
    cidades: [
      "Belo Horizonte", "Uberlândia", "Contagem", "Juiz de Fora", "Betim",
      "Montes Claros", "Ribeirão das Neves", "Uberaba", "Governador Valadares",
      "Ipatinga", "Sete Lagoas", "Divinópolis", "Santa Luzia", "Ibirité",
      "Poços de Caldas", "Patos de Minas", "Pouso Alegre", "Teófilo Otoni",
      "Barbacena", "Sabará", "Varginha", "Conselheiro Lafaiete", "Vespasiano",
      "Itabira", "Araguari", "Ubá", "Coronel Fabriciano", "Muriaé", "Ituiutaba",
      "Araxá", "Lavras", "Itajubá", "Passos", "Nova Lima", "Caratinga",
      "Pará de Minas", "Patrocínio", "Manhuaçu", "São João del Rei", "Três Corações",
      "Unaí", "João Monlevade", "Curvelo", "Janaúba", "Esmeraldas", "Timóteo",
      "Frutal", "Itaúna", "Paracatu", "Formiga", "Ouro Preto", "Mariana",
      "Diamantina", "Janaúba", "Brumadinho", "Mateus Leme", "Igarapé",
      "São Joaquim de Bicas", "Nova Serrana", "Bom Despacho", "Pirapora",
      "Bocaiúva", "Almenara", "Capelinha", "Salinas", "São Francisco",
      "Buritis", "Arcos", "Lagoa Santa", "Pedro Leopoldo", "Matozinhos",
      "Confins", "Mateus Leme", "Itabirito", "Ouro Branco", "Congonhas",
      "Cataguases", "Leopoldina", "Caxambu", "Três Pontas", "São Lourenço",
      "Boa Esperança", "Alfenas", "Machado", "Andradas", "Campo Belo",
    ],
  },
  {
    id: "equatorial-go",
    nome: "Equatorial Goiás",
    uf: "GO",
    bonusMax: 100,
    bonusLabel: "50% + 50%",
    tier: "alto",
    cidades: [
      "Goiânia", "Aparecida de Goiânia", "Anápolis", "Rio Verde", "Luziânia",
      "Águas Lindas de Goiás", "Valparaíso de Goiás", "Trindade", "Formosa",
      "Novo Gama", "Senador Canedo", "Catalão", "Itumbiara", "Jataí",
      "Planaltina", "Caldas Novas", "Cidade Ocidental", "Goianésia",
      "Mineiros", "Cristalina", "Inhumas", "Quirinópolis", "Goiatuba",
      "Santo Antônio do Descoberto", "Padre Bernardo", "Alexânia", "Pirenópolis",
      "Hidrolândia", "Bela Vista de Goiás", "Nerópolis", "Goianira", "Abadia de Goiás",
      "Iporá", "São Luís de Montes Belos", "Acreúna", "Palmeiras de Goiás",
      "Posse", "Campos Belos", "Niquelândia", "Uruaçu", "Porangatu", "Ceres",
      "Itaberaí", "Itapuranga", "Pires do Rio", "Silvânia", "Vianópolis",
      "Edéia", "Indiara", "Bom Jesus de Goiás", "Caçu", "Mineiros",
    ],
  },
  {
    id: "equatorial-pi",
    nome: "Equatorial Piauí",
    uf: "PI",
    bonusMax: 100,
    bonusLabel: "50% + 50%",
    tier: "alto",
    cidades: [
      "Teresina", "Parnaíba", "Picos", "Piripiri", "Floriano", "Campo Maior",
      "Barras", "Altos", "União", "Esperantina", "José de Freitas",
      "Pedro II", "Oeiras", "São Raimundo Nonato", "Bom Jesus", "Corrente",
      "Uruçuí", "Luís Correia", "Cocal", "Buriti dos Lopes", "Beneditinos",
      "Demerval Lobão", "Miguel Alves", "Batalha", "Água Branca", "Valença do Piauí",
      "São João do Piauí", "Paulistana", "Simplício Mendes", "Jaicós",
      "Itainópolis", "Inhuma", "Jerumenha", "Amarante", "Regeneração",
    ],
  },
  {
    id: "equatorial-al",
    nome: "Equatorial Alagoas",
    uf: "AL",
    bonusMax: 100,
    bonusLabel: "50% + 50%",
    tier: "alto",
    cidades: [
      "Maceió", "Arapiraca", "Rio Largo", "Palmeira dos Índios",
      "União dos Palmares", "Penedo", "Coruripe", "Marechal Deodoro",
      "São Miguel dos Campos", "Delmiro Gouveia", "Santana do Ipanema",
      "São Sebastião", "Murici", "Pilar", "Atalaia", "Viçosa", "Quebrangulo",
      "Igaci", "Craíbas", "Limoeiro de Anadia", "Junqueiro", "Teotônio Vilela",
      "Campo Alegre", "Boca da Mata", "Anadia", "Maragogi", "São Luís do Quitunde",
      "Porto Calvo", "Japaratinga", "Passo de Camaragibe", "Joaquim Gomes",
      "Matriz de Camaragibe", "Branquinha", "Ibateguara", "Colônia Leopoldina",
      "Novo Lino", "Jundiá", "Messias", "Flexeiras", "Cajueiro", "Capela",
    ],
  },
  {
    id: "coelba-ba",
    nome: "Coelba",
    uf: "BA",
    bonusMax: 100,
    bonusLabel: "50% + 50%",
    tier: "alto",
    cidades: [
      "Salvador", "Feira de Santana", "Vitória da Conquista", "Camaçari",
      "Itabuna", "Juazeiro", "Ilhéus", "Jequié", "Lauro de Freitas",
      "Teixeira de Freitas", "Barreiras", "Alagoinhas", "Porto Seguro",
      "Simões Filho", "Paulo Afonso", "Eunápolis", "Santo Antônio de Jesus",
      "Valença", "Candeias", "Guanambi", "Jacobina", "Serrinha", "Senhor do Bonfim",
      "Dias d'Ávila", "Itapetinga", "Irecê", "Bom Jesus da Lapa", "Cruz das Almas",
      "Brumado", "Itamaraju", "Conceição do Coité", "Esplanada", "Catu",
      "Mata de São João", "Pojuca", "Itaberaba", "Cachoeira", "São Félix",
      "Santa Maria da Vitória", "Livramento de Nossa Senhora", "Caetité",
      "Macaúbas", "Riachão das Neves", "Cocos", "Correntina", "Luís Eduardo Magalhães",
      "Formosa do Rio Preto", "Wanderley", "Santa Rita de Cássia", "Xique-Xique",
      "Jeremoabo", "Curaçá", "Casa Nova", "Sento Sé", "Sobradinho", "Remanso",
      "Campo Formoso", "Filadélfia", "Itiúba", "Andorinha", "Monte Santo",
      "Euclides da Cunha", "Ribeira do Pombal", "Cipó", "Tucano", "Araci",
      "Tobias Barreto", "Itapicuru", "Inhambupe", "Aramari", "Acajutiba",
    ],
  },
  {
    id: "enel-ce",
    nome: "Enel Ceará",
    uf: "CE",
    bonusMax: 100,
    bonusLabel: "50% + 50%",
    tier: "alto",
    cidades: [
      "Fortaleza", "Caucaia", "Juazeiro do Norte", "Maracanaú", "Sobral",
      "Crato", "Itapipoca", "Maranguape", "Iguatu", "Quixadá",
      "Aquiraz", "Pacatuba", "Eusébio", "Aracati", "Crateús", "Tianguá",
      "Russas", "Quixeramobim", "Pacajus", "Acaraú", "Camocim", "Icó",
      "Horizonte", "Itaitinga", "Cascavel", "Beberibe", "Canindé",
      "Morada Nova", "Boa Viagem", "Tauá", "Ipueiras", "Senador Pompeu",
      "Granja", "Marco", "Bela Cruz", "Trairi", "Paraipaba", "Jaguaribe",
      "Limoeiro do Norte", "Tabuleiro do Norte", "Brejo Santo", "Barbalha",
      "Missão Velha", "Mauriti", "Milagres", "Lavras da Mangabeira",
      "Várzea Alegre", "Cedro", "Acopiara", "Mombaça", "Solonópole",
      "Quiterianópolis", "Independência", "Novo Oriente", "Parambu",
    ],
  },
  {
    id: "neoenergia-pe",
    nome: "Neoenergia Pernambuco",
    uf: "PE",
    bonusMax: 100,
    bonusLabel: "50% + 50%",
    tier: "alto",
    cidades: [
      "Recife", "Jaboatão dos Guararapes", "Olinda", "Caruaru", "Petrolina",
      "Paulista", "Cabo de Santo Agostinho", "Camaragibe", "Garanhuns",
      "Vitória de Santo Antão", "Igarassu", "São Lourenço da Mata", "Santa Cruz do Capibaribe",
      "Abreu e Lima", "Ipojuca", "Serra Talhada", "Araripina", "Gravatá",
      "Carpina", "Goiana", "Belo Jardim", "Arcoverde", "Ouricuri",
      "Salgueiro", "Surubim", "Palmares", "Bezerros", "Pesqueira",
      "Limoeiro", "Bom Jardim", "Timbaúba", "Nazaré da Mata", "Buíque",
      "Águas Belas", "Bonito", "Glória do Goitá", "Custódia", "Floresta",
      "Cabrobó", "Petrolândia", "Tupanatinga", "Itaíba", "Lagoa do Itaenga",
      "Cumaru", "Passira", "Vertentes", "Casinhas", "Toritama", "Riacho das Almas",
      "Tracunhaém", "Aliança", "Itaquitinga", "Itapissuma", "Itamaracá",
      "Sirinhaém", "Rio Formoso", "Tamandaré", "Barreiros", "São José da Coroa Grande",
      "Maraial", "Catende", "Jaqueira", "Quipapá", "Lajedo", "Canhotinho",
      "Brejão", "Paranatama", "São João", "São Bento do Una", "Cachoeirinha",
      "Calçado", "Saloá", "Capoeiras", "Iati", "Águas Belas", "Inajá",
      "Tabira", "São José do Egito", "Itapetim", "Solidão", "Triunfo",
      "Carnaíba", "Calumbi", "Flores", "Mirandiba", "Verdejante",
      "Santa Cruz da Baixa Verde", "Quixaba", "Brejinho", "Ingazeira",
    ],
  },
  {
    id: "energisa-mt",
    nome: "Energisa Mato Grosso",
    uf: "MT",
    bonusMax: 100,
    bonusLabel: "50% + 50%",
    tier: "alto",
    cidades: [
      "Cuiabá", "Várzea Grande", "Rondonópolis", "Sinop", "Tangará da Serra",
      "Cáceres", "Sorriso", "Lucas do Rio Verde", "Barra do Garças", "Primavera do Leste",
      "Alta Floresta", "Pontes e Lacerda", "Nova Mutum", "Campo Verde",
      "Diamantino", "Mirassol d'Oeste", "Colíder", "Juína", "Juara", "Guarantã do Norte",
      "Peixoto de Azevedo", "Matupá", "Vera", "Cláudia", "Feliz Natal",
      "Itaúba", "Marcelândia", "Nova Ubiratã", "Tapurah", "Itanhangá",
      "Brasnorte", "Castanheira", "Aripuanã", "Colniza", "Cotriguaçu",
      "Comodoro", "Vale de São Domingos", "Vila Bela da Santíssima Trindade",
      "Jauru", "Araputanga", "São José dos Quatro Marcos", "Indiavaí",
      "Lambari d'Oeste", "Reserva do Cabaçal", "Salto do Céu", "Rio Branco",
      "Glória d'Oeste", "Curvelândia", "Mirassol d'Oeste", "Cáceres",
      "Poconé", "Nossa Senhora do Livramento", "Santo Antônio do Leverger",
      "Chapada dos Guimarães", "Nobres", "Rosário Oeste", "Acorizal",
      "Jangada", "Nova Brasilândia", "Planalto da Serra", "Campo Novo do Parecis",
    ],
  },
  {
    id: "energisa-ms",
    nome: "Energisa Mato Grosso do Sul",
    uf: "MS",
    bonusMax: 100,
    bonusLabel: "50% + 50%",
    tier: "alto",
    cidades: [
      "Campo Grande", "Dourados", "Três Lagoas", "Corumbá", "Ponta Porã",
      "Naviraí", "Nova Andradina", "Aquidauana", "Sidrolândia", "Maracaju",
      "Paranaíba", "Coxim", "Amambai", "Caarapó", "Rio Brilhante",
      "São Gabriel do Oeste", "Chapadão do Sul", "Cassilândia", "Costa Rica",
      "Bonito", "Jardim", "Bela Vista", "Aral Moreira", "Iguatemi",
      "Mundo Novo", "Eldorado", "Fátima do Sul", "Vicentina", "Glória de Dourados",
      "Anastácio", "Miranda", "Bodoquena", "Porto Murtinho", "Jaraguari",
      "Terenos", "Bandeirantes", "Camapuã", "Rio Verde de Mato Grosso",
      "Sonora", "Pedro Gomes", "Ribas do Rio Pardo", "Brasilândia",
      "Selvíria", "Aparecida do Taboado", "Inocência", "Água Clara",
    ],
  },
  {
    id: "energisa-minas-rio",
    nome: "Energisa Minas Rio (RJ)",
    uf: "RJ",
    bonusMax: 100,
    bonusLabel: "50% + 50%",
    tier: "alto",
    cidades: [
      "Nova Friburgo", "Cabo Frio", "Macaé", "Teresópolis", "Petrópolis",
      "Itaperuna", "Campos dos Goytacazes", "Araruama", "São Pedro da Aldeia",
      "Saquarema", "Maricá", "Rio das Ostras", "Búzios", "Iguaba Grande",
      "Arraial do Cabo", "Casimiro de Abreu", "Silva Jardim", "Conceição de Macabu",
      "Carapebus", "Quissamã", "São João da Barra", "São Francisco de Itabapoana",
      "Cardoso Moreira", "São Fidélis", "Italva", "Cambuci", "Bom Jesus do Itabapoana",
      "Natividade", "Porciúncula", "Varre-Sai", "Laje do Muriaé", "Miracema",
      "Santo Antônio de Pádua", "Aperibé", "Cantagalo", "Cordeiro", "Macuco",
      "Bom Jardim", "Duas Barras", "Sumidouro", "São Sebastião do Alto",
      "Trajano de Moraes", "Carmo", "Sapucaia", "Três Rios", "Areal",
      "Comendador Levy Gasparian", "Paraíba do Sul", "Paty do Alferes", "Vassouras",
      "Miguel Pereira", "Mendes", "Engenheiro Paulo de Frontin", "Rio das Flores",
      "Valença", "Barra do Piraí", "Pinheiral", "Piraí", "Volta Redonda",
      "Barra Mansa", "Resende", "Itatiaia", "Porto Real", "Quatis", "Rio Claro",
    ],
  },
  {
    id: "cosern-rn",
    nome: "Cosern",
    uf: "RN",
    bonusMax: 100,
    bonusLabel: "50% + 50%",
    tier: "alto",
    cidades: [
      "Natal", "Mossoró", "Parnamirim", "São Gonçalo do Amarante", "Macaíba",
      "Currais Novos", "Caicó", "Açu", "Ceará-Mirim", "Apodi", "Pau dos Ferros",
      "Nova Cruz", "João Câmara", "Touros", "Santa Cruz", "Goianinha",
      "Canguaretama", "Baía Formosa", "Tibau do Sul", "Extremoz",
      "Areia Branca", "Tibau", "Grossos", "Baraúna", "Felipe Guerra",
      "Itaú", "Severiano Melo", "Upanema", "Carnaubais", "Pendências",
      "Ipanguaçu", "Alto do Rodrigues", "Macau", "Guamaré", "Pedro Velho",
      "Vera Cruz", "São José de Mipibu", "Brejinho", "Passa e Fica",
      "Senador Elói de Souza", "Lagoa Salgada", "Lagoa de Pedras", "Pedro Avelino",
      "Angicos", "Lajes", "Santana do Matos", "Florânia", "Cerro Corá",
      "Bodó", "Tenente Laurentino Cruz", "Acari", "Jardim do Seridó",
      "Parelhas", "Carnaúba dos Dantas", "Equador", "São José do Seridó",
      "São João do Sabugi", "Timbaúba dos Batistas", "Jucurutu", "Triunfo Potiguar",
    ],
  },
  {
    id: "energisa-sul-sudeste",
    nome: "Energisa Sul-Sudeste",
    uf: "SP/PR/MS",
    bonusMax: 100,
    bonusLabel: "50% + 50%",
    tier: "alto",
    cidades: [
      "Ourinhos", "Avaré", "Itapeva", "Itararé", "Capão Bonito", "Paranavaí",
      "Ribeirão Branco", "Guapiara", "Itaberá", "Itaí", "Coronel Macedo",
      "Taguaí", "Fartura", "Piraju", "Timburi", "Tejupá", "Sarutaiá",
      "Bernardino de Campos", "Ribeirão do Sul", "Salto Grande", "Canitar",
      "Ipaussu", "Chavantes", "Manduri", "Cerqueira César", "Santa Cruz do Rio Pardo",
      "Iaras", "Águas de Santa Bárbara", "Espírito Santo do Turvo",
      "Óleo", "Águas de Santa Bárbara", "Borá", "Echaporã", "Lutécia",
      "Lupércio", "Vera Cruz", "Marília", "Ocauçu", "Garça", "Júlio Mesquita",
      "Alvinlândia", "Gália", "Fernão", "Pompéia", "Quintana", "Oriente",
      "Iacri", "Tupã", "Bastos", "Parapuã", "Rinópolis", "Salmourão",
    ],
  },

  // ===== TIER MÉDIO (até 50% bônus) =====
  {
    id: "elektro-sp",
    nome: "Elektro (SP/MS)",
    uf: "SP",
    bonusMax: 50,
    bonusLabel: "25% + 25%",
    tier: "medio",
    cidades: ["Sumaré", "Indaiatuba", "Itu", "Salto", "Atibaia", "Bragança Paulista", "Itapeva", "Avaré"],
  },
  {
    id: "energisa-pb",
    nome: "Energisa Paraíba",
    uf: "PB",
    bonusMax: 50,
    bonusLabel: "25% + 25%",
    tier: "medio",
    cidades: ["João Pessoa", "Campina Grande", "Santa Rita", "Patos", "Bayeux", "Sousa", "Cajazeiras"],
  },
  {
    id: "energisa-to",
    nome: "Energisa Tocantins",
    uf: "TO",
    bonusMax: 50,
    bonusLabel: "25% + 25%",
    tier: "medio",
    cidades: ["Palmas", "Araguaína", "Gurupi", "Porto Nacional", "Paraíso do Tocantins"],
  },
  {
    id: "rge-rs",
    nome: "RGE",
    uf: "RS",
    bonusMax: 50,
    bonusLabel: "25% + 25%",
    tier: "medio",
    cidades: ["Caxias do Sul", "Passo Fundo", "Bento Gonçalves", "Erechim", "Vacaria", "Farroupilha", "Bagé", "Santa Cruz do Sul"],
  },
  {
    id: "celesc-sc",
    nome: "Celesc",
    uf: "SC",
    bonusMax: 50,
    bonusLabel: "25% + 25%",
    tier: "medio",
    cidades: ["Florianópolis", "Joinville", "Blumenau", "São José", "Chapecó", "Itajaí", "Lages", "Criciúma", "Jaraguá do Sul", "Palhoça", "Balneário Camboriú"],
  },
];

// ── Lookup cidade → distribuidora ─────────────────────────────────────────
// Usado no wizard para AVISAR a qual distribuidora uma cidade pertence
// (e o bônus), sem precisar despejar todas as cidades da distribuidora na tela.

function normalizeCityName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove acentos
    .toLowerCase()
    .replace(/['`´]/g, "")
    .trim();
}

// Índice nome-normalizado → preset (construído uma vez).
const CITY_TO_PRESET: Map<string, DistribuidoraPreset> = (() => {
  const map = new Map<string, DistribuidoraPreset>();
  for (const preset of DISTRIBUIDORAS_PRESETS) {
    for (const cidade of preset.cidades) {
      const key = normalizeCityName(cidade);
      // Mantém o primeiro preset (tiers altos vêm primeiro na lista).
      if (!map.has(key)) map.set(key, preset);
    }
  }
  return map;
})();

/**
 * Descobre a distribuidora de uma cidade pelo nome. Aceita "Cidade" ou
 * "Cidade, UF" / "Cidade - UF". Retorna undefined se não houver bônus mapeado.
 */
export function findDistribuidoraForCity(cityName: string): DistribuidoraPreset | undefined {
  if (!cityName) return undefined;
  const justCity = cityName.split(/[,\-–]/)[0];
  return CITY_TO_PRESET.get(normalizeCityName(justCity));
}
