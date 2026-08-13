# ADR-005 — Permissões de Worlds e conteúdo

## Status

Aceito para a V2.0.

## Contexto

O ownership simples da V1 não expressa conteúdo compartilhado nem segredos do narrador. UUID e ocultação no React não são autorização. A resposta HTTP não pode conter conteúdo `GM_ONLY` para jogadores.

O PRD sugeriu ADR-004 para esta decisão, porém o número 003 já estava ocupado por grupos. O modelo Vault ocupa o próximo número disponível (004) e permissões usa 005 para preservar o histórico append-only dos ADRs.

## Decisão

A decisão de acesso será centralizada em funções puras de domínio. O servidor agrega fatos autenticados do D1 e fornece um contexto com owner, membership de World/grupo/campanha, papel de jogador/narrador e estado de arquivo. As rotas aplicam a decisão antes de apresentar qualquer registro e respondem 404 quando o recurso não deve ser enumerado.

| Visibilidade | Quem pode ler |
|---|---|
| `PRIVATE` | owner |
| `GROUP` | owner e conta ativa do grupo associado |
| `CAMPAIGN` | owner e membro autenticado de campanha vinculada |
| `PLAYERS` | owner, jogador ativo e narrador ativo de campanha vinculada |
| `GM_ONLY` | owner e narrador ativo de campanha vinculada |

Convidado textual nunca cria identidade web. Membership não transfere ownership. Somente owner edita, arquiva, restaura e solicita hard delete.

Conteúdo arquivado é visível somente ao owner e sai das listagens por padrão. World `GROUP` é lido por membership explícita `world_members`; World `PRIVATE` fica restrito ao owner. World arquivado fica restrito ao owner sem arquivar suas entidades.

## Integridade e riscos

- `campaign_members.user_id` e `is_game_master` são a identidade/papel confiáveis; `game_master` textual não concede acesso;
- associação `GROUP` exige grupo pertencente ao owner da entidade;
- owner só pode ligar sua entidade a campanha que também possui, bloqueando link cross-user na V2.0;
- visibilidade baseada em campanha sem vínculo concede acesso somente ao owner;
- consultas de listagem filtram no D1 e são paginadas; o React não recebe registros proibidos;
- `CAMPAIGN` e `PLAYERS` diferem porque o primeiro admite membro vinculado inativo, enquanto o segundo exige jogador ativo; narrador ativo continua autorizado em `PLAYERS`.

## Fora de escopo

Não há edição colaborativa, roles adicionais, conteúdo `PUBLIC`, comentários, realtime ou moderação nesta versão.
