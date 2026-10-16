export type Category = 'work' | 'study' | 'personal' | 'wellness' | 'errand';

export type Recurrence =
  | { frequency: 'daily' }
  | { frequency: 'weekly' }
  | { frequency: 'custom'; weekdays: number[] };

export interface DaybookTask {
  id: string;
  title: string;
  date: string;
  time: string | null;
  duration: number;
  category: Category;
  reminderMinutes: number | null;
  recurrence: Recurrence | null;
  createdAt: number;
}

export interface DaybookState {
  tasks: DaybookTask[];
  completions: Record<string, true>;
  notificationIds: Record<string, string>;
}

export interface TaskInstance {
  task: DaybookTask;
  date: string;
  completed: boolean;
}

export const EMPTY_STATE: DaybookState = {
  tasks: [],
  completions: {},
  notificationIds: {},
};
