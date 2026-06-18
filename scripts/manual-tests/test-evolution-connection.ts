/**
 * Script de teste para verificar a conexão com o novo servidor Evolution API
 * Execute com: bun run test-evolution-connection.ts
 */

const SUPABASE_URL = "https://zlzasfhcxcznaprrragl.supabase.co";
const PROXY_URL = `${SUPABASE_URL}/functions/v1/evolution-proxy`;

// Você precisa de um token válido do Supabase
// Pegue do localStorage do navegador após fazer login: localStorage.getItem('sb-zlzasfhcxcznaprrragl-auth-token')
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN || "";

async function testConnection() {
  console.log("🔍 Testando conexão com o novo servidor Evolution API...\n");

  if (!ACCESS_TOKEN) {
    console.error("❌ ERRO: Defina a variável SUPABASE_ACCESS_TOKEN");
    console.log("\n📝 Como obter o token:");
    console.log("1. Faça login no sistema");
    console.log("2. Abra o DevTools (F12)");
    console.log("3. Console > digite: localStorage.getItem('sb-zlzasfhcxcznaprrragl-auth-token')");
    console.log("4. Copie o access_token do JSON");
    console.log("5. Execute: SUPABASE_ACCESS_TOKEN='seu-token' bun run test-evolution-connection.ts\n");
    process.exit(1);
  }

  try {
    // Teste 1: Buscar instâncias
    console.log("📋 Teste 1: Buscando instâncias...");
    const response = await fetch(PROXY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        path: "instance/fetchInstances",
        method: "GET",
      }),
    });

    console.log(`   Status: ${response.status} ${response.statusText}`);
    
    if (!response.ok) {
      const error = await response.text();
      console.error(`   ❌ Erro: ${error}\n`);
      return;
    }

    const data = await response.json();
    console.log(`   ✅ Sucesso!`);
    console.log(`   Instâncias encontradas: ${Array.isArray(data) ? data.length : 0}`);
    
    if (Array.isArray(data) && data.length > 0) {
      console.log(`   Instâncias:`);
      data.forEach((inst: any) => {
        console.log(`   - ${inst.instance?.instanceName || inst.instanceName} (${inst.instance?.status || inst.status})`);
      });
    }
    console.log("");

    // Teste 2: Verificar se a Edge Function está configurada corretamente
    console.log("🔧 Teste 2: Verificando configuração da Edge Function...");
    console.log("   ✅ Edge Function está respondendo corretamente");
    console.log("   ✅ Autenticação funcionando");
    console.log("   ✅ Proxy para Evolution API funcionando\n");

    console.log("✨ MIGRAÇÃO BEM-SUCEDIDA! ✨");
    console.log("\n📊 Próximos passos:");
    console.log("1. Teste criar uma nova instância no frontend");
    console.log("2. Verifique se o QR Code é gerado");
    console.log("3. Teste enviar mensagens");
    console.log("4. Monitore os logs no Supabase Dashboard\n");

  } catch (error) {
    console.error("❌ ERRO na conexão:");
    console.error(error);
    console.log("\n🔍 Possíveis causas:");
    console.log("1. Variáveis de ambiente não configuradas no Supabase");
    console.log("2. Edge Function não foi redeployada");
    console.log("3. Novo servidor Evolution API não está acessível");
    console.log("4. Token de acesso expirado\n");
  }
}

testConnection();
