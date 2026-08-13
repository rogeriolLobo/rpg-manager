export type Priority = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';
export type ReadingStatus = 'NOT_STARTED' | 'READING' | 'READ';
export type TableStatus = 'IDEA' | 'PREPARING' | 'SCHEDULED' | 'PLAYING' | 'COMPLETED';

export interface RecommendationCandidate {
  title: string;
  wantsToPlay: boolean;
  priority: Priority;
  readingStatus: ReadingStatus;
  hasPlayGroup: boolean;
  hasPlayed: boolean;
  tableStatus: TableStatus;
}

const priorityScores: Record<Priority, number> = { NONE: 0, LOW: 10, MEDIUM: 25, HIGH: 40 };
const tableScores: Record<TableStatus, number> = { IDEA: 0, PREPARING: 15, SCHEDULED: 20, PLAYING: 25, COMPLETED: 0 };

export function calculateRpgRecommendationScore(candidate: RecommendationCandidate): number {
  return (candidate.wantsToPlay ? 100 : 0)
    + priorityScores[candidate.priority]
    + (candidate.readingStatus === 'READ' ? 30 : 0)
    + (candidate.hasPlayGroup ? 20 : 0)
    + (candidate.hasPlayed ? -20 : 20)
    + tableScores[candidate.tableStatus];
}

export function compareRecommendations(a: RecommendationCandidate, b: RecommendationCandidate): number {
  const byScore = calculateRpgRecommendationScore(b) - calculateRpgRecommendationScore(a);
  if (byScore !== 0) return byScore;
  if (a.wantsToPlay !== b.wantsToPlay) return Number(b.wantsToPlay) - Number(a.wantsToPlay);
  const byPriority = priorityScores[b.priority] - priorityScores[a.priority];
  if (byPriority !== 0) return byPriority;
  const byRead = Number(b.readingStatus === 'READ') - Number(a.readingStatus === 'READ');
  if (byRead !== 0) return byRead;
  const byGroup = Number(b.hasPlayGroup) - Number(a.hasPlayGroup);
  return byGroup || a.title.localeCompare(b.title, 'pt-BR');
}

export function calculateRpgReadiness(candidate: RecommendationCandidate): string {
  if (candidate.tableStatus === 'PLAYING') return 'Em andamento';
  if (candidate.tableStatus === 'SCHEDULED') return 'Já agendado';
  if (candidate.tableStatus === 'PREPARING') return 'Preparando';
  if (candidate.wantsToPlay) {
    if (candidate.readingStatus === 'READ') return candidate.hasPlayGroup ? 'Pronto para marcar' : 'Definir grupo';
    return candidate.hasPlayGroup ? 'Ler antes de jogar' : 'Ler e definir grupo';
  }
  if (candidate.readingStatus === 'READ') return candidate.hasPlayGroup ? 'Pronto, se houver interesse' : 'Regras lidas; avaliar interesse';
  return candidate.hasPlayGroup ? 'Grupo disponível; avaliar interesse' : 'Avaliar interesse';
}

export function calculateRpgNextAction(candidate: RecommendationCandidate): string {
  if (candidate.tableStatus === 'PLAYING') return 'Continuar campanha';
  if (candidate.tableStatus === 'SCHEDULED') return 'Preparar próxima sessão';
  if (candidate.tableStatus === 'PREPARING') return 'Fechar data e sessão zero';
  if (!candidate.wantsToPlay) return 'Marcar Quero jogar? se interessar';
  if (candidate.readingStatus !== 'READ') return 'Priorizar leitura';
  return candidate.hasPlayGroup ? 'Marcar a mesa' : 'Convidar jogadores';
}
