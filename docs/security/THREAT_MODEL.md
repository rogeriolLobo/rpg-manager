# Modelo de ameaças — RPG Manager

## Ativos e fronteiras

Ativos: credenciais, sessões, recovery codes, catálogo, campanhas, notas e backups. A fronteira pública é o Worker; o navegador nunca acessa D1 ou secrets diretamente. Todo recurso privado é resolvido com `user_id` da sessão, nunca com identidade enviada pelo cliente.

| Ameaça | Mitigação V1 | Evidência esperada |
|---|---|---|
| Roubo/replay de sessão | token CSPRNG, hash no D1, cookie HttpOnly/Secure/SameSite, expiração/revogação | testes de sessão revogada/expirada |
| Credential stuffing e brute force | rate limit Cloudflare por origem + contador por identificador com bloqueio progressivo + Turnstile | respostas 429 e mensagens genéricas |
| Enumeração de usuário | mensagens e tempos aproximados genéricos em login/recovery | testes de respostas equivalentes |
| CSRF | mesma origem, SameSite=Lax, validação estrita de Origin e token double-submit ligado à sessão | testes sem Origin/token |
| XSS | React escaping, notas como texto, sem `dangerouslySetInnerHTML`, CSP | payload persistido continua texto |
| SQL Injection | prepared statements D1 e allowlists de ordenação | payloads de regressão |
| IDOR/BOLA e manipulação de IDs | queries sempre incluem `user_id`; política 404 para recurso alheio | testes User A x User B |
| Privilege escalation/mass assignment | DTOs Zod estritos e mapeamento explícito de campos | payload desconhecido rejeitado |
| Session fixation | token novo no login/recovery/troca sensível; sessão anterior revogada | teste de token antigo |
| Vazamento de secrets | `.dev.vars` ignorado, Cloudflare Secrets, nenhum `VITE_*` secreto | revisão de git/build |
| Dados sensíveis em logs | log estruturado somente com request id, rota, método, status e duração | inspeção dos handlers |
| Abuso/oversized payload | limite de body, paginação, rate limit e validação de comprimento | testes 413/422 |
| Acesso entre usuários | ownership no SQL para RPG, campanha, membro e sessão | suíte de isolamento |
| Exclusão inconsistente | FKs explícitas, cascata apenas em dados pertencentes e RESTRICT entre RPG/campanha | migration + testes |

## Suposições e riscos residuais

TLS e proteção de rede são fornecidos pela Cloudflare. O plano Free tem limites rígidos e pode negar serviço quando a cota acabar. Conta sem verificação de e-mail é uma limitação consciente da V1 gratuita; recovery codes provam posse do segredo de recuperação, não posse contínua do endereço de e-mail. Comprometimento simultâneo de D1 e do Secret reduz a proteção do pepper.
