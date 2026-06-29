> ⚠️ **Histórico (até 28/06/2026).** Repo migrado para `tvmensal2025/igreen-page-magic`. Workers ativos aqui: `worker-portal-2`, `worker-igreen-sync`, `compress-worker`. Portal 1 (`worker-portal`) permanece em `tvmensal2025/viana-replica-vault`.

# 📦 PASSO A PASSO - ARRUMAR GITHUB

> **Guia rápido para sincronizar tudo com o GitHub**
> 
> **Data:** 14 de abril de 2026

---

## 🎯 OBJETIVO

Garantir que todo o código está no GitHub e sincronizado.

---

## 📋 PASSO A PASSO

### **PASSO 1: Verificar Estado Atual**

```bash
# Ver status do repositório
git status

# Ver branch atual
git branch

# Ver último commit
git log --oneline -5
```

---

### **PASSO 2: Adicionar Todos os Arquivos**

```bash
# Adicionar todos os arquivos novos e modificados
git add -A

# Verificar o que será commitado
git status
```

**Arquivos que serão adicionados:**
- `CORRIGIR_PORTAL_WORKER.md` (novo)
- `PASSO_A_PASSO_GITHUB.md` (novo)
- `ATUALIZACOES_RECEBIDAS.md` (modificado)
- `EXECUTANDO_TESTES.md` (novo)

---

### **PASSO 3: Fazer Commit**

```bash
# Commit com mensagem descritiva
git commit -m "🔧 docs: Guia completo para corrigir portal worker + GitHub"
```

**Mensagem do commit:**
```
🔧 docs: Guia completo para corrigir portal worker + GitHub

- Adiciona guia detalhado para corrigir portal worker no Easypanel
- Adiciona passo a passo para sincronizar GitHub
- Atualiza documentação de atualizações recebidas
- Adiciona guia de testes
```

---

### **PASSO 4: Enviar para GitHub**

```bash
# Push para o repositório remoto
git push origin main
```

**Resultado esperado:**
```
Enumerating objects: 8, done.
Counting objects: 100% (8/8), done.
Delta compression using up to 8 threads
Compressing objects: 100% (5/5), done.
Writing objects: 100% (5/5), 15.23 KiB | 15.23 MiB/s, done.
Total 5 (delta 3), reused 0 (delta 0), pack-reused 0
To https://github.com/tvmensal2025/viana-replica-vault.git
   15f8b93..abc1234  main -> main
```

---

### **PASSO 5: Verificar no GitHub**

1. Abrir: https://github.com/tvmensal2025/viana-replica-vault
2. Verificar se os arquivos novos aparecem
3. Verificar último commit

**Arquivos que devem aparecer:**
- ✅ `CORRIGIR_PORTAL_WORKER.md`
- ✅ `PASSO_A_PASSO_GITHUB.md`
- ✅ `ATUALIZACOES_RECEBIDAS.md`
- ✅ `EXECUTANDO_TESTES.md`

---

## 🔧 TROUBLESHOOTING

### **Problema 1: "Your branch is behind"**

**Erro:**
```
Your branch is behind 'origin/main' by 2 commits
```

**Solução:**
```bash
# Puxar mudanças do remoto
git pull origin main

# Resolver conflitos (se houver)
# Editar arquivos conflitantes
git add arquivo-conflitante.md

# Continuar merge
git commit -m "merge: Resolver conflitos"

# Push novamente
git push origin main
```

---

### **Problema 2: "Permission denied"**

**Erro:**
```
Permission denied (publickey)
```

**Solução:**
```bash
# Verificar se está autenticado
git config --global user.name
git config --global user.email

# Se não estiver, configurar
git config --global user.name "Seu Nome"
git config --global user.email "seu@email.com"

# Verificar remote
git remote -v

# Se necessário, usar HTTPS em vez de SSH
git remote set-url origin https://github.com/tvmensal2025/viana-replica-vault.git
```

---

### **Problema 3: "Nothing to commit"**

**Mensagem:**
```
nothing to commit, working tree clean
```

**Solução:**
Tudo já está commitado! Verificar se precisa fazer push:

```bash
# Ver se há commits não enviados
git log origin/main..HEAD

# Se houver, fazer push
git push origin main
```

---

### **Problema 4: Arquivo muito grande**

**Erro:**
```
remote: error: File xxx is 100.00 MB; this exceeds GitHub's file size limit of 100.00 MB
```

**Solução:**
```bash
# Remover arquivo do commit
git rm --cached arquivo-grande.zip

# Adicionar ao .gitignore
echo "arquivo-grande.zip" >> .gitignore

# Commit novamente
git add .gitignore
git commit -m "chore: Remover arquivo grande"
git push origin main
```

---

## 📊 COMANDOS ÚTEIS

### **Ver histórico de commits**
```bash
git log --oneline --graph --all -10
```

### **Ver diferenças**
```bash
# Ver o que mudou (antes de add)
git diff

# Ver o que será commitado (depois de add)
git diff --staged
```

### **Desfazer mudanças**
```bash
# Desfazer mudanças em arquivo (antes de add)
git checkout -- arquivo.md

# Remover arquivo do staging (depois de add)
git reset HEAD arquivo.md

# Desfazer último commit (mantém mudanças)
git reset --soft HEAD~1

# Desfazer último commit (descarta mudanças)
git reset --hard HEAD~1
```

### **Ver branches**
```bash
# Listar branches locais
git branch

# Listar branches remotos
git branch -r

# Criar nova branch
git checkout -b nova-branch

# Mudar de branch
git checkout main
```

---

## ✅ CHECKLIST FINAL

### **Antes de Push** ✅
- [ ] `git status` mostra arquivos corretos
- [ ] `git diff` mostra mudanças esperadas
- [ ] Mensagem de commit é descritiva
- [ ] Não há arquivos grandes (>100MB)
- [ ] Não há arquivos sensíveis (.env, keys)

### **Depois de Push** ✅
- [ ] Push foi bem-sucedido
- [ ] Arquivos aparecem no GitHub
- [ ] Último commit está correto
- [ ] Branch está atualizada

---

## 🎉 RESUMO

### **Comandos principais:**
```bash
# 1. Ver status
git status

# 2. Adicionar tudo
git add -A

# 3. Commit
git commit -m "mensagem"

# 4. Push
git push origin main

# 5. Verificar no GitHub
# https://github.com/tvmensal2025/viana-replica-vault
```

### **Resultado esperado:**
```
✅ Todos os arquivos no GitHub
✅ Último commit visível
✅ Branch sincronizada
✅ Sem conflitos
```

---

## 📞 LINKS ÚTEIS

### **GitHub:**
- Repositório: https://github.com/tvmensal2025/viana-replica-vault
- Commits: https://github.com/tvmensal2025/viana-replica-vault/commits/main
- Branches: https://github.com/tvmensal2025/viana-replica-vault/branches

### **Documentação:**
- Git Basics: https://git-scm.com/book/en/v2/Getting-Started-Git-Basics
- GitHub Docs: https://docs.github.com/en

---

**Versão:** 1.0.0  
**Data:** 14 de abril de 2026  
**Status:** 📋 GUIA COMPLETO

📦 **SIGA OS PASSOS E TUDO ESTARÁ NO GITHUB!** 📦
