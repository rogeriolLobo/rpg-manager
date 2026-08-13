# ADR-002 — Autenticação com sessão opaca e Web Crypto

- Status: aceito, condicionado a benchmark no runtime publicado
- Data: 2026-08-12

## Contexto

A autenticação precisa funcionar em Workers + D1, sem provedor pago, com tokens de sessão armazenados somente como hash, recovery codes de uso único, revogação individual/global e rotação após operações sensíveis.

## Auditoria de biblioteca

Better Auth 1.6.x foi avaliado por oferecer e-mail/senha, cookies e adaptador D1 mantidos ativamente. Foi rejeitado para esta V1 porque seu schema/documentação padrão persiste o token utilizável da sessão, enquanto este projeto exige que um vazamento de D1 não entregue tokens reutilizáveis. Seus fluxos padrão de recuperação também pressupõem e-mail; adaptar storage, recovery codes e eventos transacionais eliminaria boa parte do benefício e aumentaria dependências.

## Decisão

Usar APIs padronizadas do runtime, sem criar primitivas criptográficas:

- PBKDF2-HMAC-SHA-256 via `crypto.subtle`, 100.000 iterações (limite do runtime Workers), salt aleatório de 16 bytes e saída de 32 bytes;
- pepper de servidor opcional e recomendado, armazenado como Cloudflare Secret;
- sessão opaca de 32 bytes gerada por CSPRNG; somente SHA-256 do token é persistido;
- cookie `HttpOnly`, `Secure` em produção, `SameSite=Lax`, `Path=/`, duração de 7 dias;
- recovery codes aleatórios, exibidos uma vez e persistidos somente como SHA-256 com pepper;
- comparação de hashes em tempo constante;
- rotação/revogação de sessão e eventos de segurança sem dados sensíveis.

Argon2id/WASM foi rejeitado no Free plan por custo de CPU/memória incompatível com os limites operacionais adotados. Scrypt de biblioteca também não oferece garantia operacional nesse ambiente. PBKDF2 é executado pela primitiva nativa do runtime, com o custo máximo aceito pelo Workers; salt, pepper, política de senha, Turnstile e rate limiting compõem a proteção compensatória. O deploy só é considerado aprovado após registro/login reais e inspeção de CPU no Worker publicado.

## Riscos

Autenticação própria aumenta responsabilidade de manutenção. O escopo fica deliberadamente pequeno, com validação de runtime, testes de sessão/recovery/CSRF/IDOR e possibilidade futura de migrar para biblioteca que ofereça token hash nativo sem quebrar o contrato HTTP.
