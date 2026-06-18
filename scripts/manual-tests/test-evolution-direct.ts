/**
 * Teste DIRETO no servidor Evolution API (sem passar pelo Supabase)
 * Execute com: bun run test-evolution-direct.ts
 */

const EVOLUTION_URL = "http://igreen-evolution-api.d9v63q.easypanel.host";
const EVOLUTION_API_KEY = "429683C4C977415CAAFCCE10F7D57E11";

async function testDirectConnection() {
  console.log("🔍 Testando conexão DIRETA com o servidor Evolution API...\n");
  console.log(`📍 URL: ${EVOLUTION_URL}`);
  console.log(`🔑 API Key: ${EVOLUTION_API_KEY.substring(0, 10)}...\n`);

  try {
    // Teste 1: Buscar instâncias
    console.log("📋 Teste 1: GET /instance/fetchInstances");
    const response = await fetch(`${EVOLUTION_URL}/instance/fetchInstances`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "apikey": EVOLUTION_API_KEY,
      },
    });

    console.log(`   Status: ${response.status} ${response.statusText}`);
    
    const responseText = await response.text();
    
    if (!response.ok) {
      console.error(`   ❌ Erro: ${responseText}\n`);
      console.log("🔍 Possíveis causas:");
      console.log("1. Servidor Evolution API não está rodando");
      console.log("2. API Key incorreta");
      console.log("3. URL incorreta");
      console.log("4. Firewall bloqueando a conexão\n");
      return;
    }

    console.log(`   ✅ Sucesso!`);
    
    try {
      const data = JSON.parse(responseText);
      console.log(`   Instâncias encontradas: ${Array.isArray(data) ? data.length : 0}`);
      
      if (Array.isArray(data) && data.length > 0) {
        console.log(`   Instâncias:`);
        data.forEach((inst: any) => {
          console.log(`   - ${inst.instance?.instanceName || inst.instanceName} (${inst.instance?.status || inst.status})`);
        });
      }
    } catch {
      console.log(`   Resposta: ${responseText.substring(0, 200)}`);
    }
    console.log("");

    // Teste 2: Verificar saúde do servidor
    console.log("💚 Teste 2: Verificando saúde do servidor...");
    console.log("   ✅ Servidor está online");
    console.log("   ✅ API Key está funcionando");
    console.log("   ✅ Endpoint /instance/fetchInstances acessível\n");

    console.log("✨ SERVIDOR EVOLUTION API FUNCIONANDO! ✨");
    console.log("\n📊 Próximos passos:");
    console.log("1. Verifique se as variáveis estão configuradas no Supabase:");
    console.log(`   EVOLUTION_API_URL=${EVOLUTION_URL}`);
    console.log(`   EVOLUTION_API_KEY=${EVOLUTION_API_KEY}`);
    console.log("2. Redeploy da Edge Function no Supabase (se necessário)");
    console.log("3. Teste via frontend\n");

  } catch (error) {
    console.error("❌ ERRO na conexão:");
    console.error(error);
    console.log("\n🔍 Possíveis causas:");
    console.log("1. Servidor Evolution API não está rodando");
    console.log("2. URL incorreta ou inacessível");
    console.log("3. Problema de rede/firewall");
    console.log("4. Servidor está reiniciando\n");
  }
}

testDirectConnection();
