# Checkpoint autônomo — Fase F

Data: 2026-08-13

## Entregas

- ADR-006: armazenamento binário/R2 futuro;
- ADR-007: mapas, coordenadas, pins, mapas aninhados e links de entidade;
- ADR-008: Character Sheet Engine e templates PDF;
- ADR-009: compêndios, compartilhamento público e VTT;
- porta genérica `BinaryObjectStore` sem adapter remoto;
- contratos de Maps independentes do provedor de imagem;
- `SheetTemplate` genérico e validador de valores;
- testes unitários usando ficha totalmente fictícia.

## Não implementado deliberadamente

- bucket R2, billing ou mudança de plano;
- upload remoto ou URLs públicas;
- migration de metadata ainda sem caso de uso ativo;
- ficha/PDF oficial ou qualquer asset de terceiro;
- compartilhamento público, compêndio ou integração VTT;
- OAuth, realtime ou IA.

## Segurança e custo

- nenhuma nova credencial;
- nenhuma infraestrutura remota;
- nenhuma dependência de produção;
- nenhum serviço pago ou potencialmente cobrado ativado;
- contratos permanecem fora das rotas e do bundle ativo.

## Validação

- lint: aprovado;
- typecheck: aprovado;
- unitários: 60 aprovados;
- integração: 30 aprovados;
- E2E: 4 aprovados em desktop e mobile;
- build: aprovado;
- nenhum artefato da Fase F entrou no bundle ativo.

## Resultado

Preparação arquitetural concluída. Implementação das funcionalidades futuras permanece condicionada aos gates e decisões descritos nos ADRs.

## Publicação

- PR: `#7`;
- CI da PR: aprovado no run `31752739054`;
- sem migration e sem deploy: contratos não são importados pelo runtime e os hashes do bundle permaneceram iguais aos da Fase E.
