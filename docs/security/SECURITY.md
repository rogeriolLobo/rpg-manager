# Segurança

## Controles implementados

- senha: PBKDF2-HMAC-SHA-256, 600.000 iterações, salt CSPRNG único e pepper em secret;
- sessão: token opaco CSPRNG, somente hash SHA-256 com pepper no D1, expiração de 7 dias, revogação e rotação;
- cookie: `HttpOnly`, `Secure` em HTTPS, `SameSite=Lax`, `Path=/`; CSRF token separado e legível pelo cliente;
- CSRF: validação de `Origin` para métodos mutáveis e double-submit token comparado em tempo constante;
- abuso: binding nativo por IP e conta, contador D1 por conta com atraso/bloqueio progressivo e Turnstile;
- autorização: escopo por `user_id` e política 404 para recursos de outro usuário;
- injeção: prepared statements e allowlists para ordenação; nenhum valor de usuário é interpolado em SQL;
- XSS: React escapa texto, URLs são validadas e CSP restringe script/frame/object;
- mass assignment: objetos Zod estritos; limites de tamanho e payload de 1 MB;
- headers: CSP, HSTS, `nosniff`, frame denial, referrer, permissions e COOP;
- secrets: `.dev.vars` e `.env` ignorados; secrets remotos pelo Wrangler;
- logs: request ID, método, rota, status e duração; sem body, senha, token ou código.

`style-src 'unsafe-inline'` permanece na V1 para os estilos de progresso calculados no React. Scripts inline continuam bloqueados. A remoção exige migrar larguras dinâmicas para classes/atributos previamente enumerados.

## Reporte

Não publique vulnerabilidades em issue pública. Envie o relato privado ao proprietário do repositório com impacto, reprodução mínima e versão afetada. Não inclua credenciais ou dados reais.

O modelo detalhado está em [THREAT_MODEL.md](THREAT_MODEL.md).
