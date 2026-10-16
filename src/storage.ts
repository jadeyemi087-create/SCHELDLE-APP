import { EMPTY_STATE, type DaybookState } from './types';

const STORAGE_KEY = 'daybook.state.v1';
let memoryFallback: string | null = null;

function normalizeState(value: unknown): DaybookState {
  if (!value || typeof value !== 'object') return { ...EMPTY_STATE };
  const candidate = value as Partial<DaybookState>;
  return {
    tasks: Array.isArray(candidate.tasks) ? candidate.tasks : [],
    completions: candidate.completions && typeof candidate.completions === 'object' ? candidate.completions : {},
    notificationIds: candidate.notificationIds && typeof candidate.notificationIds === 'object' ? candidate.notificationIds : {},
  };
}

export async function loadDaybookState(): Promise<DaybookState> {
  try {
    const serialized = typeof localStorage === 'undefined' ? memoryFallback : localStorage.getItem(STORAGE_KEY);
    return serialized ? normalizeState(JSON.parse(serialized)) : { ...EMPTY_STATE };
  } catch (error) {
    console.warn('Could not load the local Daybook data.', error);
    return { ...EMPTY_STATE };
  }
}

export async function saveDaybookState(state: DaybookState): Promise<void> {
  const serialized = JSON.stringify(state);
  try {
    memoryFallback = serialized;
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, serialized);
  } catch (error) {
    console.warn('Could not save the local Daybook data.', error);
  }
}
