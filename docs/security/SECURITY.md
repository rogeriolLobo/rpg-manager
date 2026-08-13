# Segurança

## Controles implementados

- senha: PBKDF2-HMAC-SHA-256 no máximo suportado pelo Workers (100.000 iterações), salt CSPRNG único e pepper em secret;
- sessão: token opaco CSPRNG, somente hash SHA-256 com pepper no D1, expiração de 7 dias, revogação e rotação;
- cookie: `HttpOnly`, `Secure` em HTTPS, `SameSite=Lax`, `Path=/`; CSRF token separado e legível pelo cliente;
- CSRF: validação de `Origin` para métodos mutáveis e double-submit token comparado em tempo constante;
- abuso: binding nativo por IP e conta, contador D1 por conta com atraso/bloqueio progressivo e Turnstile;
- autorização: helpers centrais para owner/membership, predicado SQL do Vault e política 404 para recurso inacessível;
- injeção: prepared statements e allowlists para ordenação; nenhum valor de usuário é interpolado em SQL;
- XSS: React escapa texto, URLs são validadas e CSP restringe script/frame/object;
- mass assignment: objetos Zod estritos; limites de tamanho e payload de 1 MB;
- headers: CSP, HSTS, `nosniff`, frame denial, referrer, permissions e COOP;
- secrets: `.dev.vars` e `.env` ignorados; secrets remotos pelo Wrangler;
- logs: request ID, método, rota, status e duração; sem body, senha, token ou código.

## Conteúdo compartilhado V2

`PRIVATE`, `GROUP`, `CAMPAIGN`, `PLAYERS` e `GM_ONLY` são decididos no backend. Owner é o único que edita, arquiva, restaura ou exclui. Entidades arquivadas deixam de ser compartilhadas; continuam visíveis ao owner. `GROUP` exige conta cadastrada e membro ativo, `CAMPAIGN` exige membership autenticada, `PLAYERS` exige participante ativo (o narrador também lê) e `GM_ONLY` exige narrador ativo. O cliente não recebe conteúdo sem acesso, nem mesmo como dado oculto.

World membership não é inferida de campanha. Convites são explícitos em `world_members`, e apenas o owner gerencia essa lista.

## Relações V2.2

Uma relação só é retornada quando o usuário pode visualizar as duas entidades e satisfaz a visibilidade adicional da aresta. `GROUP` exige membership explícita no World. `CAMPAIGN`, `PLAYERS` e `GM_ONLY` exigem uma campanha comum às duas pontas e o papel correspondente. Relações `PRIVATE` são exclusivas do owner. Graph e Genealogy recebem a mesma projeção filtrada; não existe filtragem de segredo apenas no React.

Criação e edição validam owner, World e ambas as pontas. IDs de outro usuário ou World não são aceitos. Prepared statements, schemas Zod estritos, limites e política 404 cobrem SQL injection, mass assignment e IDOR. Arquivamento não remove os nós.

`style-src 'unsafe-inline'` permanece na V1 para os estilos de progresso calculados no React. Scripts inline continuam bloqueados. A remoção exige migrar larguras dinâmicas para classes/atributos previamente enumerados.

## Reporte

Não publique vulnerabilidades em issue pública. Envie o relato privado ao proprietário do repositório com impacto, reprodução mínima e versão afetada. Não inclua credenciais ou dados reais.

O modelo detalhado está em [THREAT_MODEL.md](THREAT_MODEL.md).
