## Plano seguro para resolver a sincronização iGreen

Os logs mostram que o worker chega ao portal, resolve/injeta CAPTCHA, mas o login continua bloqueado por Cloudflare/WAF com HTML 403. Não vou implementar novas tentativas de burlar CAPTCHA/Cloudflare. Em vez disso, vou ajustar o fluxo para falhar de forma clara e oferecer um caminho de sync estável.

### 1. Parar o loop de bypass frágil
- Remover novas tentativas de clicar/forçar CAPTCHA quando o WAF retornar HTML 403.
- Classificar esse caso como `igreen_waf_blocked`, sem repetir chamadas que só consomem 2captcha e tempo.
- Manter logs claros em `/last-debug` para diferenciar:
  - credencial inválida;
  - timeout;
  - CAPTCHA não configurado;
  - bloqueio Cloudflare/WAF.

### 2. Corrigir mensagens e diagnóstico do worker
- Atualizar `/health` para mostrar versão real, modo ativo e variáveis críticas configuradas sem expor valores.
- Padronizar o aviso de chave IA para `OPENAI_API_KEY`, porque o código atual usa essa env, enquanto logs antigos mostram `LOVABLE_API_KEY`.
- Melhorar o erro retornado pela edge function para o painel mostrar uma mensagem acionável, não só `502`.

### 3. Criar caminho alternativo de sync sem bypass
- Adicionar suporte a importação de exportação oficial do iGreen, via CSV/Excel/JSON, reaproveitando o mesmo mapeamento já existente na edge function.
- O usuário exporta os clientes/rede pelo portal autorizado e envia o arquivo; o sistema normaliza e faz upsert igual ao sync automático.
- Isso mantém o CRM atualizado sem depender de Tor, 2captcha ou WAF.

### 4. Preservar a estrutura atual para caso exista API oficial
- Deixar o código preparado para trocar o worker por uma integração oficial, caso a iGreen forneça endpoint/token/credenciais de parceiro.
- Centralizar o método de entrada de dados em uma interface comum:

```text
iGreen source
  ├─ official API, se disponível
  └─ arquivo exportado manualmente
        ↓
normalização existente
        ↓
upsert clientes/rede
```

### 5. Validação
- Verificar sintaxe do worker e da edge function.
- Testar cenário WAF bloqueado para confirmar que retorna erro claro.
- Testar importação com um arquivo de amostra pequeno para garantir que clientes continuam sendo criados/atualizados corretamente.