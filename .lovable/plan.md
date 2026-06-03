A análise da Onda A identificou 1 bug crítico estrutural que impede as legendas automáticas de funcionar no caso mais comum (vídeo reutilizado do cache, onde thumbUrl já existe).

```text
ANTES (bug): o bloco de upload de captions SRT está DENTRO de:
    if (!thumbUrl && fbVideoId) { ... }
    → Se thumbUrl já existe (cache), captions NUNCA são enviadas.

DEPOIS (fix): o bloco de captions fica FORA dessa condição,
    executando sempre que captions_srt + fbVideoId existirem.
```

---

Tarefa
- Corrigir `supabase/functions/facebook-create-campaign/index.ts`: mover o bloco de anexação de legendas SRT (linhas 544-572) para fora do `if (!thumbUrl && fbVideoId)`.
- Garantir que o `fbVideoId` ainda está em escopo no novo local (está — declarado mais acima no mesmo bloco).
- Verificar que não há regressão de sintaxe (chaves fechando corretamente).

Arquivo único: `supabase/functions/facebook-create-campaign/index.ts`