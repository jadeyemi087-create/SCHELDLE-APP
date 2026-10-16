import { EMPTY_STATE, type DaybookState } from './types';

const STORAGE_KEY = 'daybook.state.v1';
let sqliteStore: { getItemAsync: (key: string) => Promise<string | null>; setItemAsync: (key: string, value: string) => Promise<void> } | null = null;

function normalizeState(value: unknown): DaybookState {
  if (!value || typeof value !== 'object') return { ...EMPTY_STATE };
  const candidate = value as Partial<DaybookState>;
  return {
    tasks: Array.isArray(candidate.tasks) ? candidate.tasks : [],
    completions: candidate.completions && typeof candidate.completions === 'object' ? candidate.completions : {},
    notificationIds: candidate.notificationIds && typeof candidate.notificationIds === 'object' ? candidate.notificationIds : {},
  };
}

async function getNativeStore() {
  if (!sqliteStore) {
    const { SQLiteStorage } = await import('expo-sqlite/kv-store');
    sqliteStore = new SQLiteStorage('daybook.db');
  }
  return sqliteStore;
}

export async function loadDaybookState(): Promise<DaybookState> {
  try {
    const serialized = await (await getNativeStore()).getItemAsync(STORAGE_KEY);
    return serialized ? normalizeState(JSON.parse(serialized)) : { ...EMPTY_STATE };
  } catch (error) {
    console.warn('Could not load the local Daybook data.', error);
    return { ...EMPTY_STATE };
  }
}

export async function saveDaybookState(state: DaybookState): Promise<void> {
  try {
    await (await getNativeStore()).setItemAsync(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn('Could not save the local Daybook data.', error);
  }
}
