// F-004 (GM Tools): lógica pura do rolador de dados e do timer — sem D1/Workers, testável
// isoladamente. Nenhuma persistência: tudo client-side (ver src/client/pages/gm-tools-page.tsx).
const DICE_PATTERN = /^(\d{1,2})d(\d{1,3})([+-]\d{1,3})?$/iu;

export interface RollResult { notation: string; rolls: number[]; modifier: number; total: number }

// `random` é injetável só para tornar o teste determinístico (Math.random por padrão) — nunca
// usado para nada sensível a segurança, é só um dado de mesa.
export function parseDiceNotation(notation: string): { count: number; sides: number; modifier: number } | null {
  const match = DICE_PATTERN.exec(notation.trim());
  if (!match) return null;
  const count = Number(match[1]);
  const sides = Number(match[2]);
  const modifier = match[3] ? Number(match[3]) : 0;
  if (count < 1 || count > 20 || sides < 2 || sides > 1000) return null;
  return { count, sides, modifier };
}

export function rollDice(notation: string, random: () => number = Math.random): RollResult | null {
  const parsed = parseDiceNotation(notation);
  if (!parsed) return null;
  const rolls = Array.from({ length: parsed.count }, () => 1 + Math.floor(random() * parsed.sides));
  return { notation: notation.trim(), rolls, modifier: parsed.modifier, total: rolls.reduce((sum, value) => sum + value, 0) + parsed.modifier };
}

export function formatTimerSeconds(totalSeconds: number): string {
  const minutes = Math.floor(Math.abs(totalSeconds) / 60);
  const seconds = Math.abs(totalSeconds) % 60;
  return `${totalSeconds < 0 ? '-' : ''}${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
