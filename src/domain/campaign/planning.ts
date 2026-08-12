export type CampaignStatus = 'PLANNING' | 'SESSION_ZERO' | 'PREPARING' | 'IN_PROGRESS' | 'PAUSED' | 'COMPLETED';

export interface CampaignPlanningState {
  status: CampaignStatus;
  sessionZeroDate: string | null;
  firstSessionDate: string | null;
  frequency: string | null;
  nextSessionDate: string | null;
  hasCharacters: boolean;
  sessionsCompleted: number;
  sessionGoal: number | null;
}

export function calculateCampaignStage(state: CampaignPlanningState): string {
  if (state.status === 'COMPLETED') return 'Concluída';
  if (state.status === 'PAUSED') return 'Pausada';
  if (!state.sessionZeroDate) return 'Sessão Zero';
  if (!state.hasCharacters) return 'Personagens';
  if (!state.firstSessionDate) return 'Primeira sessão';
  if (!state.frequency) return 'Frequência';
  return 'Em andamento';
}

export function calculateNextCampaignAction(state: CampaignPlanningState): string {
  if (state.status === 'COMPLETED') return 'Registrar encerramento';
  if (state.status === 'PAUSED') return 'Decidir retomada';
  if (!state.sessionZeroDate) return 'Agendar Sessão Zero';
  if (!state.hasCharacters) return 'Definir personagens';
  if (!state.firstSessionDate) return 'Agendar primeira sessão';
  if (!state.frequency) return 'Definir frequência';
  if (!state.nextSessionDate) return 'Agendar próxima sessão';
  return 'Preparar próxima sessão';
}

export function calculateCampaignProgress(state: CampaignPlanningState): number | null {
  if (state.status === 'COMPLETED') return 100;
  if (!state.sessionGoal) return null;
  return Math.min(100, Math.round((state.sessionsCompleted / state.sessionGoal) * 100));
}

