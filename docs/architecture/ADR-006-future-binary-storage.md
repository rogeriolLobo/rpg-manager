# ADR-006 — Armazenamento binário futuro

Status: proposto; nenhuma infraestrutura provisionada.

## Contexto

Maps, uploads e templates PDF precisam de objetos binários. D1 deve guardar metadados e autorização, não arquivos grandes. R2 é candidato natural no ambiente atual, mas habilitação de billing, criação de bucket e credenciais estão fora da execução autônoma.

## Decisão

- domínio depende de `BinaryObjectStore`, não do SDK R2;
- chave é opaca e nunca deriva diretamente do nome enviado pelo usuário;
- metadata futura deve guardar owner, World opcional, MIME permitido, tamanho, SHA-256, status de quarentena e timestamps;
- upload deve usar limite de tamanho, allowlist MIME por assinatura, checksum, nomes seguros e autorização antes de emitir acesso;
- objetos privados nunca usam URL pública permanente; entrega deve passar por endpoint autenticado ou URL assinada curta;
- remoção deve ser assíncrona/idempotente depois de tombstone no metadata.

## Gate para implementação

Exige decisão explícita sobre provedor/custo, bucket, limites de upload, retenção, backup, antivírus e política de conteúdo. Até lá não existe adapter remoto nem migration de metadata.
