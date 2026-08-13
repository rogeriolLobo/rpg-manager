# RPG Manager V2.1 — estado atual e plano arquitetural

Data da auditoria: 2026-08-13

## Objetivo e limite do trabalho

A V2.1 evolui o `World` de cadastro para contexto permanente de conhecimento, preparação, consulta e colaboração controlada. A implementação deve reutilizar as entidades do Vault: Wiki, busca e portal apresentam a mesma `vault_entity`, sem copiar NPCs, Locations, Lore, Adventures ou qualquer outro tipo.

Continuam fora deste ciclo relações semânticas entre entidades, grafo, genealogia, timeline visual, calendário fictício, mapas, arquivos e uploads, fichas, VTT, combate, realtime, IA e monetização.

O arquivo de PRD recebido termina no início da seção 6, após o exemplo da navegação do World ativo. Portanto, os itens numerados do escopo são autoritativos, mas não vieram acompanhados dos contratos detalhados que aparentemente existiriam depois desse ponto. As decisões abaixo são deliberadamente conservadoras e aditivas.

## Arquitetura observada

- Aplicação monolítica TypeScript para Cloudflare Workers e D1.
- API Hono em `src/server`; cliente React/Vite em `src/client`.
- Validação compartilhada por Zod em `src/shared/validation/schemas.ts`.
- Regras puras de autorização de conteúdo em `src/domain/content/permissions.ts`.
- Consultas de autorização reutilizáveis em `src/server/content/authorization.ts`.
- Não existem camadas formais de repository/application service. As rotas fazem a orquestração e executam SQL diretamente. A V2.1 preservará esse padrão para evitar uma refatoração transversal sem relação com o produto.
- O cliente usa um wrapper único de `fetch`, com cookie de sessão, CSRF e erros tipados.
- O design system usa tokens CSS da identidade Huginn & Muninn, possui temas claro/escuro/sistema e bootstrap que evita flash de tema.
- O pipeline de CI executa lint, dois typechecks, testes unitários com cobertura, integração em Workers/D1, build e Playwright.

## Estruturas atuais que serão reutilizadas

### Identidade e segurança

- `users`, `auth_sessions`, recuperação, rate limit e eventos de segurança permanecem inalterados.
- Todas as rotas V2.1 autenticadas continuam sob `requireAuth`, `requireCsrf` e verificação de origem.
- Convites armazenarão somente o hash do segredo. O código em texto puro será devolvido apenas na criação e apresentado ao destinatário pelo link.

### Worlds e membros

- `worlds` já contém proprietário, slug, descrição, RPG padrão, visibilidade, estado e arquivamento.
- `world_members` já expressa proprietário e leitor (`OWNER`, `VIEWER`).
- `authorizedWorld` e `ownedWorld` são os pontos de entrada para leitura e mutação.
- O World ativo será uma preferência do usuário, não um novo tipo de domínio nem uma propriedade global do World.

### Vault, Lore e Adventures

- `vault_entities` é a fonte única para os 11 tipos de entidade.
- Hierarquia via `parent_entity_id` continua exclusiva de Locations.
- `adventure_details` já especializa Adventure sem duplicar a entidade.
- Lore ampliada seguirá o mesmo modelo de tabela de detalhes 1:1.
- Metadados editoriais da Wiki apontarão para `vault_entities.id`.

### Permissões atuais

O proprietário sempre pode ler seu conteúdo, inclusive arquivado. Usuários que não são proprietários nunca veem conteúdo arquivado.

- `PRIVATE`: somente proprietário.
- `GROUP`: proprietário e membro ativo do grupo vinculado.
- `CAMPAIGN`: proprietário e membro cadastrado de campanha vinculada.
- `PLAYERS`: proprietário, jogadores ativos e narradores ativos da campanha vinculada.
- `GM_ONLY`: proprietário e narradores ativos da campanha vinculada.
- World `PRIVATE`: somente proprietário.
- World `GROUP`: proprietário e membros explícitos do World.

Wiki, busca global e portal usarão o mesmo predicado de entidade; pastas, tags e aliases não concedem acesso por si próprios. Mutações editoriais, Diário e convites são exclusivas do proprietário nesta versão. O Diário do narrador não terá modo público implícito.

### Groups, Campaigns e Sessions

- Grupos possuem jogadores cadastrados, vínculo opcional com usuário e papel de narrador.
- Campanhas e sessões permanecem independentes do World, com vínculos reutilizáveis por `campaign_entities`.
- A V2.1 não duplicará campanhas dentro do World. A navegação contextual poderá filtrar ou abrir campanhas relacionadas às entidades daquele World.

### Frontend reutilizável

- `AppShell` concentra sidebar e navegação responsiva.
- `WorldDetailPage`, `VaultPage` e `VaultDetailPage` já oferecem dashboard, listagem e edição de entidades.
- Componentes e classes existentes de cards, filtros, formulários, estados vazios, alertas e paginação devem ser reutilizados.
- `ThemeProvider`, tokens e ícones Lucide atendem claro, escuro, desktop e mobile.

## Mudanças de persistência previstas

1. Preferência `active_world_id`, com `ON DELETE SET NULL`.
2. Pastas editoriais da Wiki, com hierarquia limitada ao mesmo World.
3. Metadado 1:1 que posiciona uma entidade existente em uma pasta.
4. Tags do World e associação N:N com entidades.
5. Aliases de entidades, normalizados e únicos por entidade.
6. Detalhes 1:1 de Lore, com classificação editorial mínima.
7. Campos adicionais de preparação em `adventure_details`, sem criar outra Adventure.
8. Pastas e páginas privadas do Diário do narrador.
9. Convites de World com hash, validade, limite de uso e revogação.

Backlinks simples serão derivados de menções editoriais `[[nome ou alias]]` no conteúdo. Não haverá tabela `entity_relations`, tipo de relação ou grafo.

## Contratos de aplicação previstos

- Preferências: ler e trocar World ativo validando acesso no servidor.
- World dashboard: visão contextual, contagens autorizadas, recentes e atalhos.
- Wiki: listar entidades autorizadas por pasta/tag/tipo/consulta; proprietário gerencia estrutura e metadados.
- Diário: CRUD de pastas e páginas apenas para o proprietário do World.
- Busca global: pesquisa limitada e agrupada; toda linha passa pelo predicado de autorização correspondente.
- Command Palette: comandos locais e resultados da busca global; atalho `Ctrl/Cmd+K`.
- Convites: criar/listar/revogar como proprietário; aceitar autenticado, idempotentemente, como `VIEWER`.
- Portal do jogador: visão somente leitura do World e da Wiki, usando exatamente as permissões já aplicadas ao Vault.

## Riscos e controles

- **Vazamento por busca, aliases ou tags:** aplicar autorização de entidade antes de qualquer agrupamento ou resultado e não retornar metadados de itens invisíveis.
- **World ativo inválido:** validar associação na gravação e corrigir para o primeiro World acessível quando a preferência estiver ausente ou obsoleta.
- **Convite exposto:** segredo aleatório, hash persistido, validade, limite de usos, revogação e resposta genérica para códigos inválidos.
- **Hierarquias cíclicas:** validar pai, World e ancestralidade para pastas de Wiki e Diário.
- **Escopo arquitetural:** manter migrações aditivas e rotas coesas; não converter todo o projeto para repository/service durante esta entrega.
- **Cliente monolítico:** adicionar páginas por domínio, contexto de World ativo e componentes pequenos; evitar concentrar a V2.1 no `AppShell`.
- **Regressão V1/V2:** manter os gates atuais e acrescentar testes unitários, integração de isolamento e E2E desktop/mobile.

## Fases de execução

1. Modelo de dados, validação e preferência de World ativo.
2. Wiki, organização editorial e backlinks derivados.
3. Lore e Adventure ampliadas.
4. Diário privado do narrador.
5. Busca global e Command Palette.
6. Convites, aceite e portal do jogador.
7. Integração visual no dashboard/sidebar, testes, documentação, migração remota, deploy e smoke.

Cada fase deve manter lint, typecheck, testes existentes e build verdes antes de avançar para publicação.
