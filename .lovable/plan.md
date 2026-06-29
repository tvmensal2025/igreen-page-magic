## Objetivo
Parar o efeito de expandir/encolher sem parar na prévia de envio de etapas, mantendo o fluxo e o envio exatamente como estão.

## Plano
1. **Fixar o tamanho da janela de prévia**
   - Dar altura mínima e máxima estáveis ao `CaptureStepPreview`.
   - Transformar o conteúdo interno em área rolável, para mídia/texto grande não redimensionar o modal inteiro.

2. **Não trocar conteúdo por “Carregando…” quando já existe prévia**
   - Manter o último texto/mídias renderizados na tela enquanto uma nova consulta acontece.
   - Mostrar loading apenas como overlay discreto, sem remover o conteúdo e sem mudar a altura.

3. **Cachear a prévia por lead + consultor + etapa + variante**
   - Guardar texto renderizado, mídias e áudios ignorados em cache local do componente.
   - Ao reabrir ou quando o pai re-renderizar, usar o cache imediatamente em vez de voltar para estado vazio.

4. **Remover animações/layout shift dos cards de etapa durante envio**
   - Remover a animação `animate-exec-card` dos cards enviados no grid de captação.
   - Trocar `hover:-translate-y` e transições que mexem no tamanho/posição por estados visuais estáticos.
   - Manter botões com largura/altura fixa enquanto alternam entre ícone de enviar, loading e check.

5. **Estabilizar a lista compacta de etapas**
   - Garantir altura fixa por linha e botão de ação fixo.
   - Evitar que badges como “atual”, check e loading alterem a largura do item.

## Validação
- Abrir `/admin` na Captação.
- Clicar para enviar uma etapa.
- Confirmar que a prévia abre uma vez, não fica alternando tamanho, e o conteúdo rola internamente quando for grande.
- Enviar uma etapa e confirmar que os cards/linhas não pulam, não expandem e não encolhem repetidamente.