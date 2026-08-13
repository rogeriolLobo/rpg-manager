# Taxonomia de gêneros de RPG

## Escopo

A taxonomia do RPG Manager organiza cada título em uma categoria principal e um subgênero opcional. Ela não pretende declarar que gêneros de ficção formam um conjunto fechado: jogos híbridos e novos termos continuam surgindo.

A versão inicial ampliada contém 18 categorias e 113 subgêneros em português. Os identificadores e nomes já usados pela planilha foram preservados para manter compatibilidade com importações e registros existentes.

## Referência

A cobertura foi comparada com o diretório de gêneros do RPGGeek e com suas descrições editoriais:

- https://rpggeek.com/browse/rpggenre
- https://rpggeek.com/wiki/page/Genre_Descriptions
- https://rpggeek.com/wiki/page/Database_Structure

Os termos foram normalizados para PT-BR e agrupados no modelo de categoria/subgênero já existente. Termos transversais, como steampunk, mecha, multiverso e wuxia, foram colocados na categoria mais útil para filtragem no produto; isso é uma decisão editorial local, não uma cópia da hierarquia externa.

## Manutenção

- nunca altere um ID já referenciado por `rpgs`;
- adicione termos por migration append-only com `INSERT OR IGNORE`;
- preserve nomes reconhecidos pelo importador da planilha;
- evite duplicar sinônimos sem uma necessidade de busca concreta;
- se o produto passar a exigir múltiplos gêneros por RPG, substitua o vínculo único por uma relação N:N em uma migration própria, sem apagar a classificação existente.
