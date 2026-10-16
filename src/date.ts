import type { DaybookTask, Recurrence, TaskInstance } from './types';

export const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function toISODate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseISODate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

export function addDays(value: string, amount: number): string {
  const date = parseISODate(value);
  date.setDate(date.getDate() + amount);
  return toISODate(date);
}

export function startOfWeek(value: string): string {
  const date = parseISODate(value);
  const weekdayFromMonday = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - weekdayFromMonday);
  return toISODate(date);
}

export function getWeek(value: string): string[] {
  const monday = startOfWeek(value);
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}

export function weekdayIndex(value: string): number {
  return parseISODate(value).getDay();
}

export function formatWeekday(value: string, short = false): string {
  const name = WEEKDAY_NAMES[weekdayIndex(value)];
  return short ? name.slice(0, 3) : name;
}

export function formatDateLong(value: string): string {
  return new Intl.DateTimeFormat('en', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(parseISODate(value));
}

export function formatDateCompact(value: string): string {
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(parseISODate(value));
}

export function formatMonth(value: string): string {
  return new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }).format(parseISODate(value));
}

export function shiftTime(value: string, amountInMinutes: number): string {
  const [hour, minute] = value.split(':').map(Number);
  const total = Math.max(0, Math.min(23 * 60 + 59, hour * 60 + minute + amountInMinutes));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export function formatTime(value: string | null): string {
  if (!value) return 'Anytime';
  const [hourText, minuteText] = value.split(':');
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, '0')} ${suffix}`;
}

export function parseTimeInput(value: string): string | null | undefined {
  const input = value.trim().replace(/\./g, '').toLowerCase();
  if (!input) return null;

  const compact = input.replace(/\s/g, '');
  let hours: number;
  let minutes: number;
  let meridiem: 'am' | 'pm' | null = null;

  const compactDigits = compact.match(/^(\d{3,4})$/);
  if (compactDigits) {
    const digits = compactDigits[1];
    hours = Number(digits.slice(0, digits.length - 2));
    minutes = Number(digits.slice(-2));
  } else {
    const match = input.match(/^(\d{1,2})(?::?(\d{2}))?\s*(am|pm)?$/i);
    if (!match) return undefined;
    hours = Number(match[1]);
    minutes = Number(match[2] ?? '0');
    meridiem = (match[3]?.toLowerCase() as 'am' | 'pm' | undefined) ?? null;
  }

  if (minutes > 59) return undefined;
  if (meridiem) {
    if (hours < 1 || hours > 12) return undefined;
    if (meridiem === 'am') hours = hours === 12 ? 0 : hours;
    else hours = hours === 12 ? 12 : hours + 12;
  } else if (hours < 0 || hours > 23) {
    return undefined;
  }

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function isTaskOnDate(task: DaybookTask, date: string): boolean {
  if (date < task.date) return false;
  if (!task.recurrence) return date === task.date;
  return recurrenceIncludes(task.recurrence, task.date, date);
}

export function recurrenceIncludes(recurrence: Recurrence, anchorDate: string, date: string): boolean {
  if (date < anchorDate) return false;
  if (recurrence.frequency === 'daily') return true;
  const weekday = weekdayIndex(date);
  if (recurrence.frequency === 'weekly') return weekday === weekdayIndex(anchorDate);
  return recurrence.weekdays.includes(weekday);
}

export function completionKey(taskId: string, date: string): string {
  return `${taskId}::${date}`;
}

export function getTaskInstances(
  tasks: DaybookTask[],
  date: string,
  completions: Record<string, true>,
): TaskInstance[] {
  return tasks
    .filter((task) => isTaskOnDate(task, date))
    .map((task) => ({
      task,
      date,
      completed: Boolean(completions[completionKey(task.id, date)]),
    }))
    .sort((left, right) => {
      const leftTime = left.task.time ?? '99:99';
      const rightTime = right.task.time ?? '99:99';
      return leftTime.localeCompare(rightTime) || left.task.createdAt - right.task.createdAt;
    });
}

export function dateAtTime(date: string, time: string): Date {
  const [hour, minute] = time.split(':').map(Number);
  const parsedDate = parseISODate(date);
  parsedDate.setHours(hour, minute, 0, 0);
  return parsedDate;
}

export function getGreeting(now = new Date()): string {
  const hour = now.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}
