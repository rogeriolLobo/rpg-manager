// LIB-003: identidade de Publication via ISBN. Lógica pura (sem D1/Workers),
// compartilhada entre validação de input (schemas.ts), cadastro/edição manual
// (rpgs.ts) e import CSV (transfer.ts) — ver docs/library/PUBLICATION_IDENTITY.md.
//
// Não inventa ISBN: só classifica como válido um valor que realmente bate no
// checksum oficial (ISO 2108 para ISBN-10, EAN-13 para ISBN-13). Não faz fuzzy
// match — identidade é só por igualdade exata do ISBN-13 canônico.

// Remove espaços/hífens e uniformiza o dígito verificador 'x' -> 'X'. Não remove
// nenhum outro caractere — entrada com letras/símbolos inesperados fica inválida
// naturalmente pelas regex de checksum abaixo, em vez de ser "limpa" às cegas.
function stripIsbn(raw: string): string {
  return raw.trim().replace(/[\s-]/gu, '').toUpperCase();
}

export function isValidIsbn10(value: string): boolean {
  if (!/^\d{9}[\dX]$/u.test(value)) return false;
  let sum = 0;
  for (let index = 0; index < 9; index += 1) sum += (10 - index) * Number(value[index]);
  sum += value[9] === 'X' ? 10 : Number(value[9]);
  return sum % 11 === 0;
}

export function isValidIsbn13(value: string): boolean {
  if (!/^\d{13}$/u.test(value)) return false;
  let sum = 0;
  for (let index = 0; index < 12; index += 1) sum += Number(value[index]) * (index % 2 === 0 ? 1 : 3);
  const check = (10 - (sum % 10)) % 10;
  return check === Number(value[12]);
}

// Conversão ISBN-10 -> ISBN-13 equivalente (prefixo 978 + 9 primeiros dígitos +
// dígito verificador EAN-13 recalculado). Só usada para obter uma chave de
// identidade (isbn13) quando o usuário forneceu ISBN-10 — o valor originalmente
// digitado continua preservado à parte (ver ClassifiedIsbn.source), nunca
// substituído silenciosamente na exibição.
export function isbn10ToIsbn13(isbn10: string): string {
  const core = `978${isbn10.slice(0, 9)}`;
  let sum = 0;
  for (let index = 0; index < 12; index += 1) sum += Number(core[index]) * (index % 2 === 0 ? 1 : 3);
  const check = (10 - (sum % 10)) % 10;
  return `${core}${check}`;
}

export interface ClassifiedIsbn {
  /** Forma normalizada (sem espaços/hífens) exatamente como fornecida — para exibição. */
  normalized: string;
  /** ISBN-10 preenchido só quando o valor fornecido FOI um ISBN-10 válido. */
  isbn10: string | null;
  /** ISBN-13: direto se fornecido em 13 dígitos, ou derivado de um ISBN-10 válido — sempre presente quando o ISBN é válido. Chave de identidade canônica. */
  isbn13: string | null;
}

/** Classifica um ISBN como válido (retorna a forma normalizada + isbn10/isbn13) ou inválido (null). Vazio/whitespace não é erro — retorna null (campo opcional). */
export function classifyIsbn(raw: string | null | undefined): ClassifiedIsbn | null {
  if (!raw || !raw.trim()) return null;
  const normalized = stripIsbn(raw);
  if (isValidIsbn13(normalized)) return { normalized, isbn10: null, isbn13: normalized };
  if (isValidIsbn10(normalized)) return { normalized, isbn10: normalized, isbn13: isbn10ToIsbn13(normalized) };
  return null;
}

export function isIsbnInputValid(raw: string | null | undefined): boolean {
  if (!raw || !raw.trim()) return true;
  return classifyIsbn(raw) !== null;
}
