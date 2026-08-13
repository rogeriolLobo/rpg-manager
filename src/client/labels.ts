const labels: Record<string, string> = {
  NONE: "Sem prioridade",
  LOW: "Baixa",
  MEDIUM: "Média",
  HIGH: "Alta",
  NOT_STARTED: "Não iniciado",
  READING: "Lendo",
  READ: "Lido",
  IDEA: "Ideia",
  PREPARING: "Preparando",
  SCHEDULED: "Agendada",
  PLAYING: "Jogando",
  COMPLETED: "Concluída",
  PLANNING: "Planejando",
  SESSION_ZERO: "Sessão Zero",
  IN_PROGRESS: "Em andamento",
  PAUSED: "Pausada",
  WEEKLY: "Semanal",
  BIWEEKLY: "Quinzenal",
  MONTHLY: "Mensal",
  BIMONTHLY: "Bimestral",
  IRREGULAR: "Irregular",
};

export function displayLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return labels[value] ?? value.replaceAll("_", " ");
}
