import { Platform } from 'react-native';
import { addDays, completionKey, dateAtTime, isTaskOnDate, toISODate } from './date';
import type { DaybookState, DaybookTask } from './types';

export type ReminderAction =
  | { type: 'done'; taskId: string; date: string }
  | { type: 'snooze'; taskId: string; date: string }
  | { type: 'open'; taskId: string; date: string };

const CATEGORY_ID = 'daybook-task-reminder';
const CHANNEL_ID = 'daybook-reminders';

export async function initializeReminders(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const Notifications = await import('expo-notifications');
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
    await Notifications.setNotificationCategoryAsync(CATEGORY_ID, [
      {
        identifier: 'MARK_DONE',
        buttonTitle: 'Mark done',
        options: { opensAppToForeground: true },
      },
      {
        identifier: 'SNOOZE_10',
        buttonTitle: 'Snooze 10 min',
        options: { opensAppToForeground: true },
      },
    ]);
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Task reminders',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 220, 120, 220],
      lightColor: '#F26B1D',
    });
  } catch (error) {
    console.warn('Reminders could not be initialized on this device.', error);
  }
}

export async function listenForReminderActions(
  onAction: (action: ReminderAction) => void,
): Promise<{ remove: () => void } | null> {
  if (Platform.OS === 'web') return null;
  const Notifications = await import('expo-notifications');
  return Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data as { taskId?: string; date?: string };
    if (!data.taskId || !data.date) return;
    if (response.actionIdentifier === 'MARK_DONE') {
      onAction({ type: 'done', taskId: data.taskId, date: data.date });
    } else if (response.actionIdentifier === 'SNOOZE_10') {
      onAction({ type: 'snooze', taskId: data.taskId, date: data.date });
    } else {
      onAction({ type: 'open', taskId: data.taskId, date: data.date });
    }
  });
}

async function requestPermissionIfNeeded(Notifications: typeof import('expo-notifications')): Promise<boolean> {
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted || current.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) return true;
    const requested = await Notifications.requestPermissionsAsync();
    return requested.granted || requested.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
  } catch {
    return false;
  }
}

export async function scheduleInstanceReminder(task: DaybookTask, date: string): Promise<string | null> {
  if (Platform.OS === 'web' || task.time === null || task.reminderMinutes === null) return null;
  const startAt = dateAtTime(date, task.time);
  const fireAt = new Date(startAt.getTime() - task.reminderMinutes * 60_000);
  if (fireAt.getTime() <= Date.now()) return null;

  try {
    const Notifications = await import('expo-notifications');
    if (!(await requestPermissionIfNeeded(Notifications))) return null;
    return await Notifications.scheduleNotificationAsync({
      content: {
        title: task.reminderMinutes === 0 ? `Time for ${task.title}` : `Coming up: ${task.title}`,
        body: task.reminderMinutes === 0 ? 'Your task starts now.' : `Starting at ${startAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. Take a breath and get ready.`,
        sound: true,
        categoryIdentifier: CATEGORY_ID,
        data: { taskId: task.id, date },
        color: '#5E2A0E',
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: fireAt,
        channelId: CHANNEL_ID,
      },
    });
  } catch (error) {
    console.warn('This reminder could not be scheduled.', error);
    return null;
  }
}

export async function cancelReminder(notificationId: string | undefined): Promise<void> {
  if (!notificationId || Platform.OS === 'web') return;
  try {
    const Notifications = await import('expo-notifications');
    await Notifications.cancelScheduledNotificationAsync(notificationId);
  } catch (error) {
    console.warn('A scheduled reminder could not be cancelled.', error);
  }
}

export async function scheduleSnoozedReminder(
  task: DaybookTask,
  date: string,
  seconds = 10 * 60,
): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  try {
    const Notifications = await import('expo-notifications');
    if (!(await requestPermissionIfNeeded(Notifications))) return null;
    return await Notifications.scheduleNotificationAsync({
      content: {
        title: `A gentle nudge: ${task.title}`,
        body: 'Your task is waiting when you are ready.',
        sound: true,
        categoryIdentifier: CATEGORY_ID,
        data: { taskId: task.id, date },
        color: '#5E2A0E',
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds,
        channelId: CHANNEL_ID,
      },
    });
  } catch (error) {
    console.warn('The reminder could not be snoozed.', error);
    return null;
  }
}

function instanceDateRange(task: DaybookTask, today: string): string[] {
  if (!task.recurrence) return task.date >= today ? [task.date] : [];
  const firstDate = task.date > today ? task.date : today;
  const dates: string[] = [];
  for (let offset = 0; offset < 30 && dates.length < 7; offset += 1) {
    const date = addDays(firstDate, offset);
    if (isTaskOnDate(task, date)) dates.push(date);
  }
  return dates;
}

/** Replaces a task's scheduled alerts when its reminder settings are edited. */
export async function refreshTaskReminders(
  task: DaybookTask,
  state: DaybookState,
): Promise<Record<string, string>> {
  const nextIds = { ...state.notificationIds };
  const taskPrefix = `${task.id}::`;
  const oldKeys = Object.keys(nextIds).filter((key) => key.startsWith(taskPrefix));
  await Promise.all(oldKeys.map((key) => cancelReminder(nextIds[key])));
  oldKeys.forEach((key) => delete nextIds[key]);

  if (task.reminderMinutes === null || task.time === null || Platform.OS === 'web') return nextIds;
  const today = toISODate(new Date());
  const dates = instanceDateRange(task, today);
  for (const date of dates) {
    if (state.completions[completionKey(task.id, date)]) continue;
    const notificationId = await scheduleInstanceReminder(task, date);
    if (notificationId) nextIds[completionKey(task.id, date)] = notificationId;
  }
  return nextIds;
}

export async function refreshAllTaskReminders(state: DaybookState): Promise<Record<string, string>> {
  let notificationIds = { ...state.notificationIds };
  const today = toISODate(new Date());
  for (const task of state.tasks) {
    const taskPrefix = `${task.id}::`;
    const taskKeys = Object.keys(notificationIds).filter((key) => key.startsWith(taskPrefix));
    const upcomingKeys = taskKeys.filter((key) => key.slice(taskPrefix.length) >= today);
    taskKeys.filter((key) => key.slice(taskPrefix.length) < today).forEach((key) => delete notificationIds[key]);
    if (upcomingKeys.length > 0 || task.reminderMinutes === null || !task.time) continue;
    const dates = instanceDateRange(task, today);
    for (const date of dates) {
      if (state.completions[completionKey(task.id, date)]) continue;
      const notificationId = await scheduleInstanceReminder(task, date);
      if (notificationId) notificationIds[completionKey(task.id, date)] = notificationId;
    }
  }
  return notificationIds;
}
