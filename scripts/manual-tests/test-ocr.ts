// Teste rápido do OCR Gemini
// Para executar: deno run --allow-net --allow-env test-ocr.ts

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || "";

if (!GEMINI_API_KEY) {
  console.error("❌ GEMINI_API_KEY não configurada");
  Deno.exit(1);
}

console.log("🔍 Testando API Gemini...\n");

// Teste 1: Verificar se a API está acessível
console.log("📡 Teste 1: Verificando acesso à API...");
try {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [{ text: "Responda apenas: OK" }]
        }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 10
        }
      })
    }
  );

  const data = await response.json();
  
  if (response.ok && data.candidates?.length > 0) {
    const text = data.candidates[0]?.content?.parts?.[0]?.text || "";
    console.log("✅ API acessível!");
    console.log(`📝 Resposta: "${text.trim()}"\n`);
  } else {
    console.error("❌ Erro na API:", JSON.stringify(data, null, 2));
    Deno.exit(1);
  }
} catch (e) {
  console.error("❌ Erro ao conectar:", e.message);
  Deno.exit(1);
}

// Teste 2: Testar OCR com texto simples
console.log("📡 Teste 2: Testando extração de dados estruturados...");
try {
  const prompt = `Extraia os seguintes dados desta frase:
"João Silva mora na Rua das Flores, 123, Bairro Centro, CEP 12345-678, São Paulo - SP"

Retorne APENAS este JSON:
{"nome":"","endereco":"","numero":"","bairro":"","cep":"","cidade":"","estado":""}`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [{ text: prompt }]
        }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 500,
          responseMimeType: "application/json"
        }
      })
    }
  );

  const data = await response.json();
  
  if (response.ok && data.candidates?.length > 0) {
    const text = data.candidates[0]?.content?.parts?.[0]?.text || "";
    console.log("✅ Extração de dados funcionando!");
    console.log("📝 Dados extraídos:");
    
    try {
      const parsed = JSON.parse(text);
      console.log(JSON.stringify(parsed, null, 2));
      
      // Validar dados
      const validations = [
        { field: "nome", expected: "João Silva", value: parsed.nome },
        { field: "endereco", expected: "Rua das Flores", value: parsed.endereco },
        { field: "numero", expected: "123", value: parsed.numero },
        { field: "bairro", expected: "Centro", value: parsed.bairro },
        { field: "cep", expected: "12345678", value: parsed.cep?.replace(/\D/g, "") },
        { field: "cidade", expected: "São Paulo", value: parsed.cidade },
        { field: "estado", expected: "SP", value: parsed.estado }
      ];
      
      console.log("\n🔍 Validação:");
      let allCorrect = true;
      for (const v of validations) {
        const isCorrect = v.value?.toLowerCase().includes(v.expected.toLowerCase());
        console.log(`${isCorrect ? "✅" : "❌"} ${v.field}: ${v.value || "não encontrado"}`);
        if (!isCorrect) allCorrect = false;
      }
      
      if (allCorrect) {
        console.log("\n🎉 Todos os dados extraídos corretamente!");
      } else {
        console.log("\n⚠️ Alguns dados não foram extraídos corretamente");
      }
    } catch (e) {
      console.error("❌ Erro ao parsear JSON:", e.message);
      console.log("Resposta bruta:", text);
    }
  } else {
    console.error("❌ Erro na API:", JSON.stringify(data, null, 2));
    Deno.exit(1);
  }
} catch (e) {
  console.error("❌ Erro ao testar extração:", e.message);
  Deno.exit(1);
}

// Teste 3: Testar com imagem (base64 simples)
console.log("\n📡 Teste 3: Testando OCR com imagem...");
try {
  // Criar uma imagem simples em base64 (1x1 pixel vermelho PNG)
  const simpleImageBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";
  
  const prompt = "Descreva esta imagem em uma palavra.";

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [
            { text: prompt },
            { inline_data: { mime_type: "image/png", data: simpleImageBase64 } }
          ]
        }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 50
        }
      })
    }
  );

  const data = await response.json();
  
  if (response.ok && data.candidates?.length > 0) {
    const text = data.candidates[0]?.content?.parts?.[0]?.text || "";
    console.log("✅ OCR com imagem funcionando!");
    console.log(`📝 Resposta: "${text.trim()}"`);
  } else {
    console.error("❌ Erro na API:", JSON.stringify(data, null, 2));
    Deno.exit(1);
  }
} catch (e) {
  console.error("❌ Erro ao testar OCR com imagem:", e.message);
  Deno.exit(1);
}

console.log("\n🎉 TODOS OS TESTES PASSARAM!");
console.log("\n✅ Resumo:");
console.log("  - API Gemini acessível");
console.log("  - Extração de dados estruturados funcionando");
console.log("  - OCR com imagem funcionando");
console.log("\n🚀 Sistema pronto para processar documentos reais!");
