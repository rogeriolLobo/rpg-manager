# Política de cadeia de release — HEAD = origin/main = produção

## Regra

Ao encerrar uma funcionalidade, a cadeia abaixo precisa ser verificável:

```
HEAD = origin/main = build commit = production commit
```

provada via `GET /api/v1/version`, não por memória.

## Sequência obrigatória

```
code
→ tests
→ docs
→ commit final
→ push
→ CI
→ deploy
→ production verification
→ stop
```

Documentação necessária ao release (checklist de DoD, `MASTER_BACKLOG.md`
etc.) é commitada **antes** do deploy final — nunca depois. Depois do
deploy final, não criar commit só para registrar Worker Version ID,
timestamp de build ou resultado de smoke: esses dados vão no relatório
da sessão (ou em um mecanismo de release que não avance o Git HEAD), não
em um novo commit.

Se um commit pós-deploy for mesmo inevitável (ex.: correção encontrada
depois), o relatório deve declarar explicitamente que `origin/main` está
à frente da produção — nunca afirmar igualdade que não foi verificada.

## Por que isso quebrou em LIB-002, LIB-003 e LIB-004

`GET /api/v1/version` lê `src/server/build-info.ts`, gerado a partir de
`git rev-parse --short HEAD` no momento do build. Esse arquivo **era
versionado no Git**. Isso cria uma impossibilidade estrutural: o arquivo
commitado precisaria conter o hash do commit que o está commitando —
o que não existe até o commit ser feito. Todo release terminava com o
commit de documentação (que registra Worker Version/proof) ficando um
commit à frente do que foi de fato implantado, porque regenerar e
commitar o arquivo de novo só empurraria o problema adiante
indefinidamente. Em LIB-002 e LIB-003 isso não foi percebido; em LIB-004
foi (ver commit `4e1b0af`), e a causa raiz foi corrigida nesta mesma
sessão.

## Correção estrutural

`src/server/build-info.ts` deixou de ser rastreado
(`.gitignore` + `git rm --cached`). Ele é **sempre gerado on-the-fly**
por `scripts/generate-build-info.mjs`, disparado via hooks `pre*` do
npm antes de qualquer script que precise dele: `predev`, `prebuild`,
`pretypecheck`, `pretest`, `pretest:integration`, `predeploy`. Isso
garante que o valor embutido no build sempre reflete o commit
efetivamente presente no checkout (local, CI ou no ambiente de deploy)
— nunca um valor commitado anteriormente, nunca defasado.

Com isso, a sequência obrigatória acima consegue produzir igualdade
real: o commit final (com código + testes + docs) é publicado, o deploy
subsequente gera `build-info.ts` a partir desse mesmo commit, e nenhum
commit adicional é necessário para "fechar" a cadeia.
