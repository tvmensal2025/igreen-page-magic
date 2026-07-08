## Objetivo

Criar um fluxo automático no Admin para parar de depender de tentativa manual: o sistema vai buscar na Meta os números WhatsApp disponíveis, comparar com a Página configurada, salvar o `phone_number_id` correto quando possível e mostrar exatamente o que ainda falta quando a Meta bloquear.

## O que será feito

1. **Criar/ajustar edge function de auto-validação**
   - Criar uma função `facebook-auto-fix-whatsapp` ou ampliar a função existente de diagnóstico.
   - Ela vai:
     - Ler a conta Facebook da plataforma.
     - Buscar a Página configurada.
     - Buscar WABAs acessíveis no Business.
     - Buscar números de telefone dessas WABAs.
     - Comparar com o número autorizado/destino salvo, incluindo `+55`, somente dígitos e formatos alternativos.
     - Se encontrar um número válido, salvar automaticamente em `consultant_ad_settings.whatsapp_phone_number_id` e/ou configuração correspondente.
     - Se não encontrar, retornar um diagnóstico claro: número não está na WABA, WABA não está vinculada à Página, token sem permissão, business errado ou página errada.

2. **Adicionar botão automático no Admin**
   - No painel de Ads/Dados, adicionar um botão destacado:
     - `Validar e corrigir WhatsApp automaticamente`
   - Ao clicar, ele chama a edge function e mostra:
     - Página detectada.
     - WABA detectada.
     - Números encontrados.
     - Número salvo.
     - Resultado final: pronto para publicar ou ação pendente na Meta.

3. **Melhorar a validação antes de publicar campanha**
   - Antes de criar campanha, executar a validação automática.
   - Se o sistema encontrar o `phone_number_id` correto, salvar e seguir.
   - Se a Meta retornar `This WhatsApp phone number is not linked to your account`, bloquear antes da criação da campanha e exibir a causa real.

4. **Salvar histórico do diagnóstico no banco**
   - Reusar uma tabela existente de logs se possível, ou criar um campo/log simples se necessário.
   - Registrar:
     - Página usada.
     - WABA encontrada.
     - Telefones encontrados.
     - Telefone esperado.
     - Erro Meta bruto.
     - Data da última validação.

5. **Links diretos no erro**
   - Quando ainda precisar ação manual na Meta, mostrar botões:
     - `Abrir números WhatsApp no Meta`
     - `Abrir contas WhatsApp Business`
     - `Abrir configurações da Página`
   - Assim você não precisa procurar onde clicar.

## Resultado esperado

Depois da implementação, você clica em um único botão no Admin. O sistema tenta resolver sozinho. Se a Meta permitir, ele salva o número correto e libera a publicação. Se não permitir, ele mostra a causa exata e o link direto do lugar onde precisa corrigir.

## Arquivos prováveis

- `supabase/functions/facebook-diagnose-page/index.ts`
- nova função `supabase/functions/facebook-auto-fix-whatsapp/index.ts` se for melhor separar
- `supabase/functions/facebook-create-campaign/index.ts`
- `supabase/functions/facebook-detect-waba/index.ts`
- `src/hooks/useCtwaPreflight.ts`
- `src/components/admin/DadosTab.tsx`
- componentes do painel de Ads/Admin onde fica a configuração de dados

## Observação importante

Se o número realmente não estiver vinculado à WABA/Página dentro da Meta, nenhum código consegue forçar a Meta a aceitar. Mas o sistema vai automatizar tudo que é possível: detectar, salvar o ID correto, reverificar e apontar exatamente onde está o bloqueio.