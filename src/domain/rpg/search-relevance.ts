// LIB-004A: causa raiz do bug "Rastro de Cthulhu" → "The Trail of Cthulhu"
// (August Derleth) — a Open Library é uma busca full-text ampla (Solr) que
// pode retornar UM ÚNICO resultado fracamente relacionado (fuzzy match sobre
// metadata de edições traduzidas) e, até aqui, o provider aceitava QUALQUER
// doc retornado como se fosse um match confiável. Este módulo é puro
// (sem D1/fetch) e decide, LOCALMENTE, o quão relevante um candidato
// realmente é para a query digitada — nunca confiamos apenas na ordenação
// de relevância da Open Library. Ver docs/library/METADATA_PROVIDERS.md.

export type SearchConfidence = 'EXACT' | 'HIGH' | 'MEDIUM' | 'LOW';

// Ordem para sort/threshold — maior índice = mais confiável.
const TIER_ORDER: Record<SearchConfidence, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, EXACT: 3 };
export const tierRank = (tier: SearchConfidence): number => TIER_ORDER[tier];

// Abaixo disso, um resultado nunca é exibido como candidato — "é melhor
// mostrar 'nenhum resultado confiável' do que apresentar um livro errado"
// (seção 6 do pedido LIB-004A).
export const MIN_DISPLAY_CONFIDENCE: SearchConfidence = 'MEDIUM';
export const meetsDisplayThreshold = (tier: SearchConfidence): boolean => tierRank(tier) >= tierRank(MIN_DISPLAY_CONFIDENCE);

// Normalização SÓ para comparação — nunca usada para alterar o título
// exibido/persistido (seção 4 do pedido). NFKD + remoção de diacríticos +
// minúsculas + pontuação vira espaço + espaços colapsados.
export function normalizeForCompare(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ');
}

// Lista pequena e deliberadamente curta — só artigos/preposições/conjunções
// muito comuns em pt/en/es, o suficiente para não distorcer a comparação de
// títulos bilíngues. Não é um stemmer nem uma lista exaustiva (seção 8: nunca
// tentar "tradução mágica").
const STOPWORDS = new Set([
  'a', 'o', 'os', 'as', 'um', 'uma', 'de', 'da', 'do', 'das', 'dos', 'e', 'em', 'no', 'na', 'nos', 'nas', 'para', 'com',
  'the', 'of', 'an', 'and', 'to', 'for', 'in', 'on', 'at', 'by',
  'el', 'la', 'los', 'las', 'del', 'y', 'en',
]);

export function significantTokens(normalized: string): string[] {
  return normalized.split(' ').filter((token) => token.length >= 2 && !STOPWORDS.has(token));
}

function jaccard(a: string[], b: string[]): number {
  if (!a.length && !b.length) return 0;
  const setA = new Set(a); const setB = new Set(b);
  let intersection = 0;
  for (const token of setA) if (setB.has(token)) intersection += 1;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

// Compara a query do usuário contra um candidato (título + subtítulo quando
// existir). Puramente textual — nenhum sinal externo aqui (ver
// `applyDomainBoost` para o sinal de assunto/RPG, aplicado separadamente).
export function scoreTitleMatch(query: string, title: string, subtitle?: string): { confidence: SearchConfidence; ratio: number } {
  const normQuery = normalizeForCompare(query);
  const normTitle = normalizeForCompare(title);
  const normCandidate = subtitle ? normalizeForCompare(`${title} ${subtitle}`) : normTitle;
  if (!normQuery) return { confidence: 'LOW', ratio: 0 };
  if (normQuery === normTitle || normQuery === normCandidate) return { confidence: 'EXACT', ratio: 1 };

  const queryTokens = significantTokens(normQuery);
  const candidateTokens = significantTokens(normCandidate);
  if (!queryTokens.length) return { confidence: 'LOW', ratio: 0 };
  const ratio = jaccard(queryTokens, candidateTokens);
  const containment = normCandidate.includes(normQuery) || normQuery.includes(normTitle);

  if ((containment && ratio >= 0.5) || ratio >= 0.75) return { confidence: 'HIGH', ratio };
  if (ratio >= 0.4) return { confidence: 'MEDIUM', ratio };
  return { confidence: 'LOW', ratio };
}

// Sinais bibliográficos REAIS (nunca inventados) que a Open Library às vezes
// retorna (`subject`) e que indicam conteúdo de RPG/jogo — seção 5 do pedido:
// "quando a fonte fornecer sinais bibliográficos, utilizá-los no score" mas
// "nunca criar allowlist fixa de editoras como requisito". Isto é uma lista de
// PALAVRAS-CHAVE DE ASSUNTO, não de editoras — qualquer editora pode publicar
// um RPG, mas um assunto "Fiction"/"Horror tales" nunca é elevado por ela.
const RPG_SUBJECT_KEYWORDS = [
  'role playing', 'role-playing', 'roleplaying', 'rpg', 'fantasy games', 'war games',
  'tabletop', 'game design', 'games/puzzles', 'gamebooks', 'games & activities', 'wargames',
];

export function hasRpgSubjectSignal(subjects: string[] | undefined): boolean {
  if (!subjects?.length) return false;
  return subjects.some((subject) => {
    const lower = subject.toLowerCase();
    return RPG_SUBJECT_KEYWORDS.some((keyword) => lower.includes(keyword));
  });
}

// Só amplifica confiança já MÉDIA para ALTA — nunca eleva LOW (não pode
// "inventar" relevância textual que não existe só porque o assunto bate) nem
// promove a EXACT (reservado para igualdade textual literal ou identificador
// confiável como ISBN/alias confirmado). Ver seção "case E" do pedido:
// resultado de ficção parecido nunca deve ser elevado por não ter esse sinal.
export function applyDomainBoost(confidence: SearchConfidence, hasSignal: boolean): SearchConfidence {
  return confidence === 'MEDIUM' && hasSignal ? 'HIGH' : confidence;
}
