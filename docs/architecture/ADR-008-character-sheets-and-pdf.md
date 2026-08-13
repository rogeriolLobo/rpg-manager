# ADR-008 — Character Sheet Engine e PDF

Status: contrato genérico preparado; sem fichas ou PDFs oficiais.

## Decisão

- `SheetTemplate` versionado define campos `TEXT`, `NUMBER`, `BOOLEAN` e `CHOICE`;
- valores são validados contra chaves e tipos declarados;
- um mapping PDF opcional referencia página e coordenadas, sem embutir o arquivo;
- cada Character deve guardar a versão do template usada para permitir migração explícita;
- renderização PDF futura recebe bytes autorizados e valores validados; não acessa rede nem conteúdo editorial.

## Direitos autorais

O projeto não distribuirá fichas oficiais, logotipos, artes ou PDFs de terceiros sem licença verificável. Testes devem gerar documento totalmente fictício do próprio projeto. Templates de comunidade exigirão autoria, licença, moderação e remoção.

## Segurança

Limites de campos/opções/tamanho, schemas estritos, sanitização, sem JavaScript embutido e sem confiar em metadados do PDF. Upload depende do ADR-006.
