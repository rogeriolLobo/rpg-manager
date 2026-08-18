// RPG-1.0-BATCH4: incrementado sempre que a identidade da sessão muda (login, registro,
// logout, expiração detectada). Existe para resolver uma corrida real encontrada via E2E:
// a checagem inicial de sessão (`AuthProvider`, dispara ao montar o app, quando o usuário
// ainda está anônimo em /login ou /register) pode ficar em voo e só resolver DEPOIS que o
// usuário já registrou/logou com sucesso — sem essa guarda, o 401 UNAUTHENTICATED "fantasma"
// dessa requisição antiga deslogava um usuário que acabou de autenticar. `api()` (client.ts)
// captura o epoch no instante em que a requisição É ENVIADA; só reage à falha se o epoch
// ainda for o mesmo quando a resposta chega — ou seja, se nada mudou a identidade da sessão
// nesse intervalo. `AuthProvider` incrementa o epoch em todo `setUser`, login ou logout.
let epoch = 0;
export function bumpSessionEpoch(): number {
  epoch += 1;
  return epoch;
}
export function currentSessionEpoch(): number {
  return epoch;
}
