## Diagnóstico

- Hoje o sistema só identifica a campanha automaticamente quando chega um sinal confiável: `ad_id`, `ctwa_clid` ou a primeira mensagem exata configurada no anúncio.
- Nos leads problemáticos, o Meta entregou só a frase genérica: `Olá! Posso ter mais informações sobre isso?`, sem `ad_id`, sem `ctwa_clid` e sem `source_referral`.
- Como existem 2 campanhas ativas do Rafael ao mesmo tempo, essa frase genérica não diferencia Jaraguá de Uberlândia/BH. O código atual manda para revisão manual para não chutar e mandar lead para parceiro errado.
- Também encontrei uma pool de rodízio ainda ativa ligada a uma campanha pausada. Isso precisa ser sincronizado para não contaminar a contagem de campanhas elegíveis.

## Objetivo da correção

Fazer o sistema reconhecer automaticamente a campanha correta mesmo com várias campanhas rodando, sem precisar mexer no código a cada nova campanha e sem inventar destino quando não houver sinal real.

## Plano de implementação

1. **Criar um identificador único por campanha**
  - Cada campanha terá um código curto exclusivo, por exemplo `#IG-A7K2P`.
  - Esse código será salvo na própria campanha e usado como chave determinística de atribuição.
2. **Inserir automaticamente o código no WhatsApp do anúncio**
  - Na criação de toda nova campanha, o sistema vai colocar o código ( protocolo )na mensagem inicial do WhatsApp. PROTOCOLO FICA MAIS PROFISSIONAL
  - Exemplo: `Oi! Gostaria de entender melhor como posso diminuir minha conta de energia. #IG-A7K2P`
  - O consultor não precisará fazer nada manualmente. EU QUERO ASSIM   
  FB-001 – Lead do Facebook.
    IG-001 – Lead do Instagram.
    GG-001 – Lead do Google.
    TT-001 – Lead do TikTok.
    WA-001 – Lead que chegou pelo WhatsApp.  
      
    MAS JA COLOQUE NUMEROS ALTOS PARA NAO PPARECER AMADOR QUE ESTAMOS COMECANDO AGROA  

3. **Corrigir as campanhas que já estão rodando agora**
  - Gerar códigos para as campanhas ativas atuais.
  - Atualizar/recriar os criativos dos anúncios no Meta com a mensagem rastreável.
  - Se a Meta não permitir editar o criativo diretamente, criar novo criativo/anúncio dentro da mesma campanha/adset e pausar o anúncio antigo.
  - Atualizar `fb_ad_ids` no banco para manter o match por `ad_id` correto.
4. **Substituir a regra atual de “uma única pool ativa”**
  - Remover a dependência de “só funciona se tiver 1 campanha”.
  - Criar um resolvedor único usado por `evolution-webhook` e `whapi-webhook` com prioridade:
  1. código único da campanha na mensagem;
  2. `ad_id` vindo do Meta;
  3. `ctwa_clid`;
  4. mensagem inicial exata;
  5. sinais auxiliares do referral/creative quando disponíveis.
    m o código único, pode haver 2, 5 ou 20 campanhas ativas: o sistema identifica a campanha certa.
5. **Sincronizar rodízio com status real da campanha**
  - Pool de campanha pausada/completed não deve participar da resolução automática.
  - Ajustar a lógica para só considerar pool ativa quando a campanha também estiver `active` ou `pending_review` válida.
  - Desativar a pool que está ativa hoje em campanha pausada, se confirmada como fora de veiculação.
6. **Evitar revisão manual para os próximos leads rastreáveis**
  - Quando o código, `ad_id` ou `ctwa_clid` chegar, o lead será atribuído direto ao rodízio correto.
  - A notificação ao parceiro usará a campanha correta e os cálculos serão feitos com `source_campaign_id` correto.
  - A revisão manual ficará apenas para casos tecnicamente impossíveis: quando o Meta/remove tudo e o lead também apaga o código antes de enviar. A correção nas campanhas reduz esse caso na origem.

## Arquivos/funções a alterar

- `supabase/functions/facebook-create-campaign/index.ts`
- `supabase/functions/evolution-webhook/index.ts`
- `supabase/functions/whapi-webhook/index.ts`
- `supabase/functions/_shared/single-pool-campaign-resolver.ts` ou substituição por um resolvedor multi-campanha
- Possível nova edge function de reparo das campanhas ativas atuais
- Migração para adicionar campos de rastreio em `facebook_campaigns`

## Validação

- Testar lead com 2+ campanhas ativas e mensagem contendo código da campanha.
- Confirmar que o `source_campaign_id` correto é salvo.
- Confirmar que `rodizio_next` usa a pool da campanha correta.
- Confirmar que o parceiro da vez recebe o lead certo.
- Confirmar que campanha pausada não entra mais no resolver.
- Conferir logs de `evolution-webhook` e `whapi-webhook` após deploy.