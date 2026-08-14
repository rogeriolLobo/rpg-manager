// Regra canônica de quando uma coverUrl precisa ser (re)validada contra a política atual
// (allowlist de hosts + verificação remota anti-SSRF):
//
// - CREATE: não existe valor persistido ainda, então toda coverUrl informada é "nova" e
//   precisa ser validada pela política atual (chame com `persisted = null`).
// - EDIT com coverUrl alterada (valor final difere do persistido): trata-se como capa NOVA,
//   aplica-se a política atual por completo.
// - EDIT sem alteração de coverUrl (valor final igual ao persistido, mesmo que o usuário tenha
//   digitado algo diferente e voltado ao valor original antes de salvar): preserva o valor
//   histórico sem reprovar por uma política que pode ter mudado depois que o dado foi salvo.
//
// A comparação é pelo VALOR final submetido, nunca por uma flag de "dirty"/"touched" — assim
// alterar e depois desfazer manualmente continua contando como "sem alteração".
export function shouldRevalidateCoverUrl(nextCoverUrl: string | null, persistedCoverUrl: string | null): boolean {
  return nextCoverUrl !== persistedCoverUrl;
}
