# ADR-009 — Compêndios, compartilhamento público e VTT

Status: proposto; funcionalidades não implementadas.

## Compêndios

Compêndio deve ser pacote versionado de conteúdo autoral/licenciado que cria cópias rastreáveis no Vault. Nunca aponta usuários para uma entidade mutável compartilhada sem consentimento. Importação exige manifesto, versão, licença, hash, limites e validação de cada tipo.

## Compartilhamento público

Usará snapshot publicado separado da entidade privada, com slug aleatório, campos allowlisted, revogação, expiração opcional e CSP própria. `GM_ONLY`, Journal, notas do narrador, memberships e IDs internos ficam fora do snapshot. Não será apenas uma nova visibility no predicado atual.

## VTT

Integrações devem viver em adapters por provedor e consumir DTOs explicitamente exportáveis. OAuth/tokens ficam criptografados ou no secret store apropriado, nunca em logs/D1 em texto puro. Exportação é idempotente e auditada; importação não sobrescreve entidade sem preview/conflito.

## Gates

Antes de implementar: escolher provedores e contratos oficiais, revisar termos/licenças, definir OAuth e revogação, threat model, limites de uso e política de suporte. Nenhuma chamada, credencial ou dependência VTT foi adicionada.
