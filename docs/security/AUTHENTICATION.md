# Autenticação

O e-mail é trimado e normalizado para minúsculas somente para busca; a grafia original é preservada para exibição. Cadastro e login sempre criam uma sessão nova. Mensagens de login e recuperação não confirmam a existência da conta.

## Senha e recuperação

Senhas aceitam 12 a 128 caracteres sem regra artificial de composição. O hash codifica algoritmo, iterações, salt e derivação; o pepper nunca vai ao D1. No cadastro são gerados 10 recovery codes CSPRNG, mostrados uma vez. Apenas a representação derivada é persistida. A recuperação consome um código, troca a senha, revoga todas as sessões e cria uma sessão substituta.

## Ciclo de sessão

O D1 guarda `created_at`, `last_seen_at`, `expires_at`, `revoked_at` e user agent resumido. Logout revoga a sessão corrente; logout global revoga todas; alteração de senha pode revogar todas as outras; uma sessão pode ser listada e invalidada pelo próprio usuário. O token puro existe apenas no cookie HttpOnly.

## Evolução futura

Recuperação por e-mail poderá ser adicionada como novo verificador sem alterar a senha/sessão. Ela não é simulada na V1 e exigirá provedor gratuito confiável, expiração, anti-replay e mensagens não enumeráveis.
