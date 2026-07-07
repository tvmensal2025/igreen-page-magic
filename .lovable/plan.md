
## Diagnóstico

O erro **"Este navegador não conseguiu tocar"** não é problema do navegador — o arquivo de áudio **não existe mais no Storage**. O WhatsApp também não consegue enviar pelo mesmo motivo (Whapi/Evolution baixa a URL e recebe 404).

**Verificação feita:**
- `ai_media_library` tem 4 rows para `sofia-mg.mp3` apontando para `…/passo_mp8yc0bp/ec2e4859-….mp3`
- `curl HEAD` nessa URL → `404 Object not found`
- Bucket `ai-agent-media` é público, mas o objeto sumiu

**Causa raiz** (bug em `StepMediaPanel.tsx`):

`linkFromLibrary` (linhas 114-144) faz **cópia da URL** para criar uma nova row apontando pro **mesmo arquivo físico**, mas grava `storage_path: null` na cópia. Resultado: várias rows de `ai_media_library` compartilham o mesmo arquivo em Storage.

Depois, `saveAllChanges` (linhas 376-412) marca a row antiga como `active=false` e chama `storage.remove([m.storage_path])`. Como a row **original** ainda tem o `storage_path`, o arquivo real é apagado — e todas as demais rows (ativas, com URL apontando pro mesmo path) ficam **quebradas silenciosamente**.

Foi exatamente o que aconteceu: row `4e3267a1` (inativa, com storage_path preenchido) foi removida junto com o arquivo; rows `648332f7`, `e9c847f4`, `a9af418c` (ativas, ligadas ao mesmo path via URL) agora retornam 404 tanto no player quanto no envio do bot.

---

## Correções

### 1. Não deletar arquivo do Storage se houver outras rows usando (`StepMediaPanel.saveAllChanges`)

Antes de chamar `storage.remove([path])`, verificar se **alguma outra row ativa** referencia o mesmo `storage_path` **ou** a mesma `url`. Se sim, pular o remove (soft-delete apenas na row).

```ts
// Para cada storage_path a remover:
const { count } = await supabase
  .from("ai_media_library")
  .select("id", { count: "exact", head: true })
  .eq("active", true)
  .or(`storage_path.eq.${path},url.eq.${url}`);
if ((count ?? 0) === 0) {
  await supabase.storage.from("ai-agent-media").remove([path]);
}
```

### 2. Recuperar o áudio quebrado agora (execução única)

- Marcar as 3 rows órfãs (`648332f7`, `e9c847f4`, `a9af418c`) com `active=false` para tirar do fluxo até novo upload
- Toast/UI passará a mostrar "Inativo" em vez de player quebrado
- Consultor sobe o `sofia-mg.mp3` de novo pelo painel (upload direto)

### 3. Melhorar diagnóstico no `AudioPlayer`

Quando `<audio>` dispara `onError`, fazer um `HEAD` na URL. Se retornar 404, trocar a mensagem para:

> **"Arquivo não encontrado no Storage — reenvie o áudio"**

em vez de "navegador não conseguiu tocar". Isso evita confusão futura e sinaliza claramente o problema real.

### 4. Preencher `storage_path` também nas cópias (`linkFromLibrary`)

Ao vincular da biblioteca, copiar também o `storage_path` da row de origem (não gravar `null`). Assim a lógica de "há mais rows apontando pra esse arquivo?" fica trivialmente correta.

---

## Arquivos afetados

- `src/components/admin/fluxo/StepMediaPanel.tsx` — corrigir `saveAllChanges` (guard antes do remove) e `linkFromLibrary` (copiar storage_path)
- `src/components/admin/media/AudioPlayer.tsx` — melhorar mensagem de erro (HEAD check → "arquivo não encontrado")
- Query manual única: `UPDATE ai_media_library SET active=false WHERE id IN ('648332f7-3f83-44ff-8e0c-240005791a0c','e9c847f4-3277-4c8e-b5f3-0e5fcb0f1195','a9af418c-24f9-4d87-ab28-e8d753a79cde')` — para o consultor reenviar o áudio limpo

Após: o consultor faz upload novo do `sofia-mg.mp3` e o fluxo M passa a enviar corretamente.
