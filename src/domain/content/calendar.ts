export interface CalendarMonth { name: string; days: number }
export interface CalendarCycle { name: string; lengthDays: number; offset: number }
export interface CalendarHoliday { name: string; monthIndex: number; day: number; description: string }
export interface WorldCalendarConfig {
  name: string;
  months: CalendarMonth[];
  weekdays: string[];
  cycles: CalendarCycle[];
  holidays: CalendarHoliday[];
}
export interface WorldCalendarDate { year: number; monthIndex: number; day: number }

function normalizedNames(names: string[]): string[] {
  return names.map((name) => name.trim().normalize('NFKC').toLocaleLowerCase('pt-BR'));
}

function hasUniqueNames(names: string[]): boolean {
  const normalized = normalizedNames(names);
  return normalized.length === new Set(normalized).size;
}

export function validateCalendarConfig(config: WorldCalendarConfig): boolean {
  if (!config.name.trim() || config.months.length === 0 || config.weekdays.length === 0) return false;
  if (!hasUniqueNames(config.months.map((month) => month.name)) || !hasUniqueNames(config.weekdays)) return false;
  if (!hasUniqueNames(config.cycles.map((cycle) => cycle.name)) || !hasUniqueNames(config.holidays.map((holiday) => holiday.name))) return false;
  if (config.months.some((month) => !month.name.trim() || month.days < 1)) return false;
  if (config.weekdays.some((weekday) => !weekday.trim())) return false;
  if (config.cycles.some((cycle) => !cycle.name.trim() || cycle.lengthDays < 1)) return false;
  return config.holidays.every((holiday) => {
    const month = config.months[holiday.monthIndex];
    return Boolean(holiday.name.trim() && month && holiday.day >= 1 && holiday.day <= month.days);
  });
}

export function validateCalendarDate(config: WorldCalendarConfig, date: WorldCalendarDate): boolean {
  const month = config.months[date.monthIndex];
  return Boolean(month && date.day >= 1 && date.day <= month.days);
}
