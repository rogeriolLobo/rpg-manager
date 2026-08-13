# Migração da Google Sheets

Fonte de referência: planilha `Jogos de RPG`, aba `Catálogo de Livros`. A cópia em `data/import/google-sheets-catalog.csv` foi obtida da fonte real em 2026-08-12 e contém 27 registros; ela pode ficar desatualizada em relação à planilha.

## Fluxo

1. Na planilha, exporte `Catálogo de Livros` como CSV, ou use a cópia versionada.
2. Cadastre a conta que será proprietária dos dados.
3. Abra `/app/settings`, selecione o CSV e peça a prévia.
4. Revise contagem, dez primeiras linhas e todos os problemas.
5. Confirme somente quando `canConfirm` estiver habilitado.
6. Confira catálogo, ranking e filtros; exporte JSON como backup inicial.
7. Depois do catálogo, exporte a aba `Campanhas` como CSV e use a importação de campanhas.

Colunas obrigatórias: `Sistema / Jogo`, `Categoria`, `Subgênero`, `Status da leitura`. O importador entende os booleanos e rótulos em português da fonte, valida a taxonomia, limita 40 linhas, não grava na prévia e usa batch na confirmação. `INSERT OR IGNORE` evita duplicata do mesmo título por usuário; jobs expiram em 30 minutos e não podem ser confirmados duas vezes.

O catálogo inclui `Quando jogar`. A importação de campanhas preserva grupo, personagens e contagem histórica como dados legados; nomes não são separados automaticamente. Depois da importação, crie um grupo reutilizável e revise jogadores/personagens antes de usar presença por sessão. A planilha nunca é consultada em runtime.
