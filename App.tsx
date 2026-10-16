import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFonts } from 'expo-font';
import { Urbanist_400Regular } from '@expo-google-fonts/urbanist/400Regular';
import { Urbanist_500Medium } from '@expo-google-fonts/urbanist/500Medium';
import { Urbanist_600SemiBold } from '@expo-google-fonts/urbanist/600SemiBold';
import { Urbanist_700Bold } from '@expo-google-fonts/urbanist/700Bold';
import {
  addDays,
  completionKey,
  dateAtTime,
  formatDateCompact,
  formatDateLong,
  formatMonth,
  formatTime,
  formatWeekday,
  getGreeting,
  getTaskInstances,
  getWeek,
  makeId,
  parseISODate,
  parseTimeInput,
  shiftTime,
  toISODate,
  WEEKDAYS,
} from './src/date';
import {
  cancelReminder,
  initializeReminders,
  listenForReminderActions,
  refreshAllTaskReminders,
  refreshTaskReminders,
  scheduleInstanceReminder,
  scheduleSnoozedReminder,
  type ReminderAction,
} from './src/reminders';
import { loadDaybookState, saveDaybookState } from './src/storage';
import { EMPTY_STATE, type Category, type DaybookState, type DaybookTask, type Recurrence, type TaskInstance } from './src/types';

const COLORS = {
  backdrop: '#E8D9DA',
  surface: '#F8F2F0',
  card: '#FFFFFF',
  ink: '#1F1F22',
  muted: '#6B6B72',
  brand: '#5E2A0E',
  accent: '#F26B1D',
  peach: '#FFD9BF',
  sage: '#DCE7B8',
  blush: '#FBD7EE',
  line: '#EDE5E2',
  softInk: '#F2EBE8',
  danger: '#8B4135',
};

const FONT = {
  regular: 'Urbanist_400Regular',
  medium: 'Urbanist_500Medium',
  semibold: 'Urbanist_600SemiBold',
  bold: 'Urbanist_700Bold',
};

type IconName = React.ComponentProps<typeof Ionicons>['name'];
type ViewMode = 'day' | 'week';
type RepeatChoice = 'none' | 'daily' | 'weekly' | 'custom';

const CATEGORIES: Record<Category, { label: string; icon: IconName; tile: string; iconColor: string }> = {
  work: { label: 'Work', icon: 'briefcase-outline', tile: COLORS.peach, iconColor: COLORS.brand },
  study: { label: 'Study', icon: 'book-outline', tile: '#E8E2F2', iconColor: '#5D4B78' },
  personal: { label: 'Personal', icon: 'heart-outline', tile: COLORS.blush, iconColor: '#925E7D' },
  wellness: { label: 'Wellness', icon: 'leaf-outline', tile: COLORS.sage, iconColor: '#576B32' },
  errand: { label: 'Errand', icon: 'basket-outline', tile: '#F0E9D9', iconColor: '#78613A' },
};

const REPEAT_OPTIONS: { value: RepeatChoice; label: string }[] = [
  { value: 'none', label: 'Never' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'custom', label: 'Choose days' },
];
const REMINDER_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: 'No reminder' },
  { value: 0, label: 'At time' },
  { value: 5, label: '5 min' },
  { value: 15, label: '15 min' },
];
const DURATION_OPTIONS = [15, 30, 45, 60];

function replaceTaskReminderIds(
  currentIds: Record<string, string>,
  taskId: string,
  refreshedIds: Record<string, string>,
): Record<string, string> {
  const prefix = `${taskId}::`;
  const result = { ...currentIds };
  Object.keys(result).forEach((key) => {
    if (key.startsWith(prefix)) delete result[key];
  });
  Object.entries(refreshedIds).forEach(([key, id]) => {
    if (key.startsWith(prefix)) result[key] = id;
  });
  return result;
}

interface DraftTask {
  title: string;
  timeInput: string;
  duration: number;
  category: Category;
  reminderMinutes: number | null;
  repeat: RepeatChoice;
  weekdays: number[];
}

function emptyDraft(date: string): DraftTask {
  return {
    title: '',
    timeInput: '',
    duration: 30,
    category: 'personal',
    reminderMinutes: null,
    repeat: 'none',
    weekdays: [parseISODate(date).getDay()],
  };
}

function recurrenceFromDraft(draft: DraftTask): Recurrence | null {
  if (draft.repeat === 'none') return null;
  if (draft.repeat === 'daily') return { frequency: 'daily' };
  if (draft.repeat === 'weekly') return { frequency: 'weekly' };
  return { frequency: 'custom', weekdays: draft.weekdays };
}

function TinyLabel({ children, style }: { children: React.ReactNode; style?: object }) {
  return <Text style={[styles.tinyLabel, style]}>{children}</Text>;
}

function AppContent() {
  const [fontsLoaded, fontError] = useFonts({
    Urbanist_400Regular,
    Urbanist_500Medium,
    Urbanist_600SemiBold,
    Urbanist_700Bold,
  });
  const [appState, setAppState] = useState<DaybookState>({ ...EMPTY_STATE });
  const appStateRef = useRef<DaybookState>(appState);
  const [isLoaded, setIsLoaded] = useState(false);
  const [today, setToday] = useState(() => toISODate(new Date()));
  const [selectedDate, setSelectedDate] = useState(() => toISODate(new Date()));
  const [viewMode, setViewMode] = useState<ViewMode>('day');
  const [editorVisible, setEditorVisible] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftTask>(() => emptyDraft(toISODate(new Date())));
  const [formError, setFormError] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [notice, setNotice] = useState('');
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const actionHandlerRef = useRef<(action: ReminderAction) => void>(() => undefined);

  const commitState = useCallback((next: DaybookState) => {
    appStateRef.current = next;
    setAppState(next);
    void saveDaybookState(next);
  }, []);

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(''), 2800);
  }, []);

  useEffect(() => {
    let mounted = true;
    const midnightRefresh = setInterval(() => {
      const nextToday = toISODate(new Date());
      setToday(nextToday);
    }, 60_000);

    const load = async () => {
      const [saved] = await Promise.all([loadDaybookState(), initializeReminders()]);
      if (!mounted) return;
      appStateRef.current = saved;
      setAppState(saved);
      setIsLoaded(true);
      void refreshAllTaskReminders(saved).then((notificationIds) => {
        if (!mounted || Object.keys(notificationIds).length === Object.keys(saved.notificationIds).length) return;
        const latest = appStateRef.current;
        const next = { ...latest, notificationIds };
        appStateRef.current = next;
        setAppState(next);
        void saveDaybookState(next);
      });
    };
    void load();

    return () => {
      mounted = false;
      clearInterval(midnightRefresh);
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    let subscription: { remove: () => void } | null = null;
    void listenForReminderActions((action) => actionHandlerRef.current(action))
      .then((result) => {
        if (!mounted) result?.remove();
        else subscription = result;
      })
      .catch((error) => console.warn('Could not listen for reminder actions.', error));

    if (Platform.OS !== 'web') {
      void (async () => {
        try {
          const Notifications = await import('expo-notifications');
          const response = await Notifications.getLastNotificationResponseAsync();
          if (!mounted || !response) return;
          const data = response.notification.request.content.data as { taskId?: string; date?: string };
          if (!data.taskId || !data.date) return;
          if (response.actionIdentifier === 'MARK_DONE') {
            actionHandlerRef.current({ type: 'done', taskId: data.taskId, date: data.date });
          } else if (response.actionIdentifier === 'SNOOZE_10') {
            actionHandlerRef.current({ type: 'snooze', taskId: data.taskId, date: data.date });
          } else {
            actionHandlerRef.current({ type: 'open', taskId: data.taskId, date: data.date });
          }
          await Notifications.clearLastNotificationResponseAsync?.();
        } catch (error) {
          console.warn('Could not handle the last notification response.', error);
        }
      })();
    }

    return () => {
      mounted = false;
      subscription?.remove();
    };
  }, []);

  const weekDates = useMemo(() => getWeek(selectedDate), [selectedDate]);
  const dayInstances = useMemo(
    () => getTaskInstances(appState.tasks, selectedDate, appState.completions),
    [appState.tasks, appState.completions, selectedDate],
  );
  const weekInstances = useMemo(
    () => weekDates.flatMap((date) => getTaskInstances(appState.tasks, date, appState.completions)),
    [appState.tasks, appState.completions, weekDates],
  );
  const doneCount = dayInstances.filter((instance) => instance.completed).length;
  const progress = dayInstances.length ? doneCount / dayInstances.length : 0;
  const timedOpenTasks = dayInstances.filter((instance) => !instance.completed && instance.task.time);
  const firstUpcomingToday = selectedDate === today
    ? timedOpenTasks.find((instance) => dateAtTime(selectedDate, instance.task.time!).getTime() >= Date.now())
    : undefined;
  const nextTimedTask = firstUpcomingToday ?? timedOpenTasks[0];
  const nextTimedLabel = selectedDate < today
    ? 'ON YOUR PLAN'
    : selectedDate > today || (nextTimedTask?.task.time && dateAtTime(selectedDate, nextTimedTask.task.time).getTime() >= Date.now())
      ? 'COMING UP'
      : 'ON YOUR PLAN';
  const rolloverTasks = selectedDate === today
    ? dayInstances.filter((instance) => !instance.completed && !instance.task.recurrence)
    : [];
  const weekMonth = weekDates[0].slice(0, 7) === weekDates[6].slice(0, 7)
    ? formatMonth(weekDates[0])
    : `${formatDateCompact(weekDates[0])} — ${formatDateCompact(weekDates[6])}`;

  const commitTaskNotificationIds = useCallback((ids: Record<string, string>) => {
    const next = { ...appStateRef.current, notificationIds: ids };
    commitState(next);
  }, [commitState]);

  const toggleTaskCompletion = useCallback((task: DaybookTask, date: string) => {
    const current = appStateRef.current;
    const key = completionKey(task.id, date);
    const isDone = Boolean(current.completions[key]);
    const completions = { ...current.completions };
    const notificationIds = { ...current.notificationIds };
    const notificationId = notificationIds[key];
    if (isDone) delete completions[key];
    else completions[key] = true;
    delete notificationIds[key];
    commitState({ ...current, completions, notificationIds });
    if (isDone) {
      void scheduleInstanceReminder(task, date).then((newId) => {
        if (!newId) return;
        const latest = appStateRef.current;
        const next = { ...latest, notificationIds: { ...latest.notificationIds, [key]: newId } };
        commitState(next);
      });
    } else {
      void cancelReminder(notificationId);
    }
  }, [commitState]);

  const handleReminderAction = useCallback((action: ReminderAction) => {
    const task = appStateRef.current.tasks.find((item) => item.id === action.taskId);
    if (action.type === 'done' && task) {
      const key = completionKey(action.taskId, action.date);
      const current = appStateRef.current;
      const notificationId = current.notificationIds[key];
      const notificationIds: Record<string, string> = {};
      Object.entries(current.notificationIds).forEach(([idKey, id]) => {
        if (idKey !== key) notificationIds[idKey] = id;
      });
      const next: DaybookState = {
        ...current,
        completions: { ...current.completions, [key]: true },
        notificationIds,
      };
      commitState(next);
      void cancelReminder(notificationId);
      setSelectedDate(action.date);
      setViewMode('day');
      showNotice('Marked done. Nicely handled.');
    } else if (action.type === 'snooze' && task) {
      void scheduleSnoozedReminder(task, action.date).then((notificationId) => {
        if (!notificationId) return;
        const current = appStateRef.current;
        const key = completionKey(action.taskId, action.date);
        const next = { ...current, notificationIds: { ...current.notificationIds, [key]: notificationId } };
        commitState(next);
        showNotice('No rush. I’ll nudge you again in 10 minutes.');
      });
      setSelectedDate(action.date);
      setViewMode('day');
    } else {
      setSelectedDate(action.date);
      setViewMode('day');
    }
  }, [commitState, showNotice]);
  actionHandlerRef.current = handleReminderAction;

  const openNewTask = useCallback(() => {
    setEditingTaskId(null);
    setDraft(emptyDraft(selectedDate));
    setFormError('');
    setConfirmingDelete(false);
    setEditorVisible(true);
  }, [selectedDate]);

  const openEditTask = useCallback((instance: TaskInstance) => {
    const task = instance.task;
    let repeat: RepeatChoice = 'none';
    if (task.recurrence?.frequency === 'daily') repeat = 'daily';
    else if (task.recurrence?.frequency === 'weekly') repeat = 'weekly';
    else if (task.recurrence?.frequency === 'custom') repeat = 'custom';
    setSelectedDate(instance.date);
    setEditingTaskId(task.id);
    setDraft({
      title: task.title,
      timeInput: task.time ? formatTime(task.time) : '',
      duration: task.duration,
      category: task.category,
      reminderMinutes: task.reminderMinutes,
      repeat,
      weekdays: task.recurrence?.frequency === 'custom'
        ? [...task.recurrence.weekdays]
        : [parseISODate(task.date).getDay()],
    });
    setFormError('');
    setConfirmingDelete(false);
    setEditorVisible(true);
  }, []);

  const closeEditor = useCallback(() => {
    Keyboard.dismiss();
    setEditorVisible(false);
    setConfirmingDelete(false);
  }, []);

  const saveTask = useCallback(() => {
    const title = draft.title.trim();
    if (!title) {
      setFormError('Give this task a name first.');
      return;
    }
    const time = parseTimeInput(draft.timeInput);
    if (time === undefined) {
      setFormError('Try a time like 9:30 AM, or leave it blank.');
      return;
    }
    if (draft.repeat === 'custom' && draft.weekdays.length === 0) {
      setFormError('Choose at least one day for this routine.');
      return;
    }

    const current = appStateRef.current;
    const now = Date.now();
    const task: DaybookTask = {
      id: editingTaskId ?? makeId(),
      title,
      date: editingTaskId
        ? current.tasks.find((item) => item.id === editingTaskId)?.date ?? selectedDate
        : selectedDate,
      time,
      duration: draft.duration,
      category: draft.category,
      reminderMinutes: time ? draft.reminderMinutes : null,
      recurrence: recurrenceFromDraft(draft),
      createdAt: editingTaskId
        ? current.tasks.find((item) => item.id === editingTaskId)?.createdAt ?? now
        : now,
    };
    const tasks = editingTaskId
      ? current.tasks.map((item) => item.id === editingTaskId ? task : item)
      : [...current.tasks, task];
    const next = { ...current, tasks };
    commitState(next);
    closeEditor();
    showNotice(editingTaskId ? 'Your changes are saved.' : 'Added to your day.');

    void refreshTaskReminders(task, next).then((notificationIds) => {
      const latest = appStateRef.current;
      commitTaskNotificationIds(replaceTaskReminderIds(latest.notificationIds, task.id, notificationIds));
    });
  }, [closeEditor, commitState, commitTaskNotificationIds, draft, editingTaskId, selectedDate, showNotice]);

  const deleteTask = useCallback(() => {
    if (!editingTaskId) return;
    const current = appStateRef.current;
    const prefix = `${editingTaskId}::`;
    const taskKeys = Object.keys(current.notificationIds).filter((key) => key.startsWith(prefix));
    taskKeys.forEach((key) => void cancelReminder(current.notificationIds[key]));
    const tasks = current.tasks.filter((task) => task.id !== editingTaskId);
    const completions = Object.fromEntries(
      Object.entries(current.completions).filter(([key]) => !key.startsWith(prefix)),
    );
    const notificationIds = Object.fromEntries(
      Object.entries(current.notificationIds).filter(([key]) => !key.startsWith(prefix)),
    );
    commitState({ ...current, tasks, completions, notificationIds });
    closeEditor();
    showNotice('Task removed from your plan.');
  }, [closeEditor, commitState, editingTaskId, showNotice]);

  const moveUnfinishedToTomorrow = useCallback(() => {
    const current = appStateRef.current;
    const movingIds = new Set(rolloverTasks.map((instance) => instance.task.id));
    if (!movingIds.size) return;
    const tomorrow = addDays(selectedDate, 1);
    const notificationIds = { ...current.notificationIds };
    Object.keys(notificationIds).forEach((key) => {
      if (movingIds.has(key.split('::')[0])) {
        void cancelReminder(notificationIds[key]);
        delete notificationIds[key];
      }
    });
    const tasks = current.tasks.map((task) => movingIds.has(task.id) ? { ...task, date: tomorrow } : task);
    const next = { ...current, tasks, notificationIds };
    commitState(next);
    setSelectedDate(tomorrow);
    showNotice(`Moved ${movingIds.size} ${movingIds.size === 1 ? 'task' : 'tasks'} to tomorrow.`);
    const movedTasks = tasks.filter((task) => movingIds.has(task.id));
    void Promise.all(movedTasks.map(async (task) => ({
      taskId: task.id,
      ids: await refreshTaskReminders(task, next),
    }))).then((reminderSets) => {
      let merged = { ...appStateRef.current.notificationIds };
      reminderSets.forEach(({ taskId, ids }) => {
        merged = replaceTaskReminderIds(merged, taskId, ids);
      });
      commitTaskNotificationIds(merged);
    });
  }, [commitState, commitTaskNotificationIds, rolloverTasks, selectedDate, showNotice]);

  const rescheduleTask = useCallback((task: DaybookTask, deltaMinutes: number) => {
    if (!task.time || task.recurrence) return;
    const movedTask = { ...task, time: shiftTime(task.time, deltaMinutes) };
    if (movedTask.time === task.time) return;
    const current = appStateRef.current;
    const next = { ...current, tasks: current.tasks.map((item) => item.id === task.id ? movedTask : item) };
    commitState(next);
    showNotice(`Moved to ${formatTime(movedTask.time)}.`);
    void refreshTaskReminders(movedTask, next).then((notificationIds) => {
      const latest = appStateRef.current;
      commitTaskNotificationIds(replaceTaskReminderIds(latest.notificationIds, movedTask.id, notificationIds));
    });
  }, [commitState, commitTaskNotificationIds, showNotice]);

  const snoozeTaskFromCard = useCallback((instance: TaskInstance) => {
    const key = completionKey(instance.task.id, instance.date);
    const current = appStateRef.current;
    const previousId = current.notificationIds[key];
    const notificationIds = { ...current.notificationIds };
    delete notificationIds[key];
    commitState({ ...current, notificationIds });
    void cancelReminder(previousId);
    void scheduleSnoozedReminder(instance.task, instance.date).then((notificationId) => {
      if (!notificationId) {
        showNotice('Snooze reminders are available on iOS and Android.');
        return;
      }
      const latest = appStateRef.current;
      const next = { ...latest, notificationIds: { ...latest.notificationIds, [key]: notificationId } };
      commitState(next);
      showNotice('I’ll nudge you again in 10 minutes.');
    });
  }, [commitState, showNotice]);

  const openToday = useCallback(() => setSelectedDate(today), [today]);

  const renderDateStrip = () => (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.dateStrip}
      accessibilityLabel="Choose a day"
    >
      {weekDates.map((date) => {
        const isSelected = date === selectedDate;
        const number = parseISODate(date).getDate();
        const hasTasks = getTaskInstances(appState.tasks, date, appState.completions).length > 0;
        return (
          <Pressable
            key={date}
            onPress={() => setSelectedDate(date)}
            style={({ pressed }) => [styles.dateOption, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={`${formatWeekday(date)}, ${formatDateCompact(date)}`}
            accessibilityState={{ selected: isSelected }}
          >
            <Text style={[styles.dateWeekday, isSelected && styles.dateWeekdaySelected]}>{formatWeekday(date, true).slice(0, 1)}</Text>
            <View style={[styles.dateCircle, isSelected && styles.dateCircleSelected]}>
              <Text style={[styles.dateNumber, isSelected && styles.dateNumberSelected]}>{number}</Text>
            </View>
            <View style={[styles.dateTaskDot, hasTasks && styles.dateTaskDotVisible, isSelected && styles.dateTaskDotSelected]} />
          </Pressable>
        );
      })}
    </ScrollView>
  );

  const renderDayView = () => (
    <>
      <View style={styles.daySummary}>
        <View style={styles.summaryCopy}>
          <TinyLabel>YOUR TIMELINE</TinyLabel>
          <Text style={styles.summaryTitle}>
            {dayInstances.length === 0
              ? 'A little room to begin'
              : `${doneCount} of ${dayInstances.length} ${dayInstances.length === 1 ? 'plan' : 'plans'} done`}
          </Text>
        </View>
        <View style={styles.summaryProgressWrap}>
          <Text style={styles.summaryPercent}>{Math.round(progress * 100)}%</Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
          </View>
        </View>
      </View>

      {dayInstances.some((instance) => !instance.completed && !instance.task.recurrence && Boolean(instance.task.time)) && (
        <View style={styles.dragHint}>
          <Ionicons name="reorder-two-outline" size={15} color={COLORS.muted} />
          <Text style={styles.dragHintText}>Drag a grip to shift a task by 30 min</Text>
        </View>
      )}

      {nextTimedTask && (
        <View style={styles.reminderCard}>
          <View style={styles.reminderIconWrap}>
            <Ionicons name="notifications-outline" size={19} color={COLORS.brand} />
          </View>
          <View style={styles.reminderCopy}>
            <TinyLabel style={styles.reminderEyebrow}>{nextTimedLabel} · {formatTime(nextTimedTask.task.time)}</TinyLabel>
            <Text numberOfLines={1} style={styles.reminderTitle}>{nextTimedTask.task.title}</Text>
            <Text style={styles.reminderNote}>
              {nextTimedTask.task.reminderMinutes === null
                ? `${nextTimedTask.task.duration} min · no reminder set`
                : nextTimedTask.task.reminderMinutes === 0
                  ? `${nextTimedTask.task.duration} min · reminder at start`
                  : `${nextTimedTask.task.duration} min · reminder ${nextTimedTask.task.reminderMinutes} min before`}
            </Text>
          </View>
          {nextTimedTask.task.reminderMinutes !== null && (
            <Pressable
              style={styles.snoozeButton}
              onPress={() => snoozeTaskFromCard(nextTimedTask)}
              accessibilityRole="button"
              accessibilityLabel={`Snooze ${nextTimedTask.task.title} for 10 minutes`}
            >
              <Ionicons name="time-outline" size={17} color={COLORS.brand} />
            </Pressable>
          )}
        </View>
      )}

      {dayInstances.length === 0 ? (
        <View style={styles.emptyCard}>
          <View style={styles.emptyIcon}>
            <Ionicons name="sunny-outline" size={25} color={COLORS.brand} />
          </View>
          <Text style={styles.emptyTitle}>Nothing on the page yet</Text>
          <Text style={styles.emptyBody}>Capture a task, give it a time, or leave it flexible. Your day can start small.</Text>
          <Pressable style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryButtonPressed]} onPress={openNewTask}>
            <Ionicons name="add" size={19} color={COLORS.card} />
            <Text style={styles.primaryButtonText}>Add your first task</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.taskList}>
          {dayInstances.map((instance, index) => (
            <TaskRow
              key={`${instance.task.id}-${instance.date}`}
              instance={instance}
              last={index === dayInstances.length - 1}
              onEdit={() => openEditTask(instance)}
              onToggle={() => toggleTaskCompletion(instance.task, instance.date)}
              onReschedule={(deltaMinutes) => rescheduleTask(instance.task, deltaMinutes)}
            />
          ))}
        </View>
      )}

      {rolloverTasks.length > 0 && (
        <View style={styles.rolloverCard}>
          <View style={styles.rolloverIcon}>
            <Ionicons name="arrow-forward-outline" size={20} color={COLORS.brand} />
          </View>
          <View style={styles.rolloverCopy}>
            <Text style={styles.rolloverTitle}>Plans can move with you.</Text>
            <Text style={styles.rolloverText}>
              {rolloverTasks.length} unfinished {rolloverTasks.length === 1 ? 'task' : 'tasks'} · recurring routines stay put
            </Text>
          </View>
          <Pressable onPress={moveUnfinishedToTomorrow} style={styles.rolloverAction}>
            <Text style={styles.rolloverActionText}>Move to tomorrow</Text>
            <Ionicons name="arrow-forward" size={15} color={COLORS.brand} />
          </Pressable>
        </View>
      )}
    </>
  );

  const renderWeekView = () => {
    const completed = weekInstances.filter((instance) => instance.completed).length;
    return (
      <>
        <View style={styles.weekSummaryCard}>
          <View style={styles.weekSummaryTop}>
            <View>
              <TinyLabel>YOUR WEEK</TinyLabel>
              <Text style={styles.weekSummaryTitle}>
                {weekInstances.length === 0
                  ? 'Open space, all week'
                  : `${weekInstances.length} ${weekInstances.length === 1 ? 'plan' : 'plans'} in view`}
              </Text>
              <Text style={styles.weekSummarySub}>
                {weekInstances.length === 0 ? 'Add a little shape when you’re ready.' : `${completed} complete · ${weekInstances.length - completed} still ahead`}
              </Text>
            </View>
            <View style={styles.weekSummaryIcon}>
              <Ionicons name="calendar-clear-outline" size={22} color={COLORS.brand} />
            </View>
          </View>
          <View style={styles.weekProgressTrack}>
            <View style={[styles.weekProgressFill, { width: `${weekInstances.length ? Math.round((completed / weekInstances.length) * 100) : 0}%` }]} />
          </View>
        </View>
        <View style={styles.weekDaysList}>
          {weekDates.map((date) => {
            const instances = getTaskInstances(appState.tasks, date, appState.completions);
            const finished = instances.filter((instance) => instance.completed).length;
            const isSelected = date === selectedDate;
            return (
              <Pressable
                key={date}
                onPress={() => {
                  setSelectedDate(date);
                  setViewMode('day');
                }}
                style={({ pressed }) => [styles.weekDayCard, isSelected && styles.weekDayCardSelected, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={`Open ${formatWeekday(date)}, ${formatDateCompact(date)}${instances.length ? `, ${instances.length} plans` : ', no plans'}`}
              >
                <View style={styles.weekDayInfo}>
                  <View style={[styles.weekDayDate, isSelected && styles.weekDayDateSelected]}>
                    <Text style={[styles.weekDayNumber, isSelected && styles.weekDayNumberSelected]}>{parseISODate(date).getDate()}</Text>
                  </View>
                  <View style={styles.weekDayText}>
                    <Text style={styles.weekDayName}>{date === today ? 'Today' : formatWeekday(date)}</Text>
                    <Text style={styles.weekDayMonth}>{formatDateCompact(date)}</Text>
                  </View>
                </View>
                <View style={styles.weekDayPreview}>
                  {instances.length > 0 ? (
                    <>
                      <Text numberOfLines={1} style={styles.weekPreviewTitle}>{instances[0].task.title}</Text>
                      {instances.length > 1 && <Text style={styles.weekPreviewMore}>+{instances.length - 1} more</Text>}
                    </>
                  ) : (
                    <Text style={styles.weekPreviewEmpty}>Open space</Text>
                  )}
                </View>
                <View style={styles.weekDayCount}>
                  {instances.length > 0 ? (
                    <>
                      <Text style={styles.weekDayCountText}>{finished}/{instances.length}</Text>
                      <View style={styles.weekTinyProgress}>
                        <View style={[styles.weekTinyProgressFill, { width: `${instances.length ? Math.round((finished / instances.length) * 100) : 0}%` }]} />
                      </View>
                    </>
                  ) : <Ionicons name="chevron-forward" size={17} color={COLORS.muted} />}
                </View>
              </Pressable>
            );
          })}
        </View>
      </>
    );
  };

  const weekdayRange = `${formatWeekday(weekDates[0], true)} ${formatDateCompact(weekDates[0])} — ${formatWeekday(weekDates[6], true)} ${formatDateCompact(weekDates[6])}`;
  const isSelectedToday = selectedDate === today;

  if ((!fontsLoaded && !fontError) || !isLoaded) {
    return (
      <View style={styles.loadingScreen}>
        <StatusBar barStyle="dark-content" />
        <View style={styles.loadingMark}><Ionicons name="sunny-outline" size={26} color={COLORS.brand} /></View>
        <Text style={styles.loadingText}>Making room for your day…</Text>
        <ActivityIndicator color={COLORS.brand} style={styles.loader} />
      </View>
    );
  }

  return (
    <View style={styles.outerShell}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <StatusBar barStyle="dark-content" />
        <View style={styles.appFrame}>
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.pageContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.brandRow}>
              <View style={styles.brandLockup}>
                <View style={styles.brandMark}>
                  <Ionicons name="checkmark" size={17} color={COLORS.card} />
                </View>
                <Text style={styles.brandName}>daybook</Text>
              </View>
              <View style={styles.localBadge}>
                <Ionicons name="phone-portrait-outline" size={12} color={COLORS.muted} />
                <Text style={styles.localBadgeText}>ON DEVICE</Text>
              </View>
            </View>

            <View style={styles.heroBlock}>
              <Text style={styles.heroTitle}>{isSelectedToday ? `${getGreeting()}.` : 'A fresh page.'}</Text>
              <Text style={styles.heroSubtitle}>Make room for what matters today.</Text>
            </View>

            <View style={styles.dateHeadingRow}>
              <View style={styles.dateHeadingCopy}>
                <TinyLabel>{viewMode === 'day' ? 'YOUR PLAN' : 'WEEK OF'}</TinyLabel>
                <Text style={styles.dateHeadingTitle} numberOfLines={1}>
                  {viewMode === 'day' ? formatDateLong(selectedDate) : weekMonth}
                </Text>
                {viewMode === 'week' && <Text style={styles.dateRange}>{weekdayRange}</Text>}
              </View>
              <View style={styles.dateControls}>
                <Pressable
                  onPress={() => setSelectedDate(addDays(selectedDate, -7))}
                  style={({ pressed }) => [styles.arrowButton, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel="Previous week"
                >
                  <Ionicons name="chevron-back" size={18} color={COLORS.ink} />
                </Pressable>
                {!isSelectedToday && (
                  <Pressable onPress={openToday} style={styles.todayButton}>
                    <Text style={styles.todayButtonText}>Today</Text>
                  </Pressable>
                )}
                <Pressable
                  onPress={() => setSelectedDate(addDays(selectedDate, 7))}
                  style={({ pressed }) => [styles.arrowButton, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel="Next week"
                >
                  <Ionicons name="chevron-forward" size={18} color={COLORS.ink} />
                </Pressable>
              </View>
            </View>

            {renderDateStrip()}

            <View style={styles.modeSwitch}>
              {(['day', 'week'] as const).map((mode) => (
                <Pressable
                  key={mode}
                  onPress={() => setViewMode(mode)}
                  style={[styles.modeButton, viewMode === mode && styles.modeButtonSelected]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: viewMode === mode }}
                >
                  <Ionicons name={mode === 'day' ? 'list-outline' : 'calendar-outline'} size={16} color={viewMode === mode ? COLORS.card : COLORS.muted} />
                  <Text style={[styles.modeButtonText, viewMode === mode && styles.modeButtonTextSelected]}>{mode === 'day' ? 'Day' : 'Week'}</Text>
                </Pressable>
              ))}
            </View>

            {notice.length > 0 && (
              <View style={styles.notice}>
                <Ionicons name="checkmark-circle" size={17} color={COLORS.brand} />
                <Text style={styles.noticeText}>{notice}</Text>
                <Pressable onPress={() => setNotice('')} hitSlop={10} accessibilityLabel="Dismiss message">
                  <Ionicons name="close" size={16} color={COLORS.muted} />
                </Pressable>
              </View>
            )}

            {viewMode === 'day' ? renderDayView() : renderWeekView()}

            <View style={styles.footerNote}>
              <Ionicons name="lock-closed-outline" size={13} color={COLORS.muted} />
              <Text style={styles.footerNoteText}>Your plans stay on this device.</Text>
            </View>
          </ScrollView>

          {(viewMode === 'week' || dayInstances.length > 0) && (
            <Pressable
              onPress={openNewTask}
              style={({ pressed }) => [styles.addButton, pressed && styles.addButtonPressed]}
              accessibilityRole="button"
              accessibilityLabel="Add a task"
            >
              <Ionicons name="add" size={27} color={COLORS.card} />
            </Pressable>
          )}
        </View>
      </SafeAreaView>

      <TaskEditor
        visible={editorVisible}
        draft={draft}
        setDraft={setDraft}
        editing={Boolean(editingTaskId)}
        error={formError}
        confirmingDelete={confirmingDelete}
        onSetConfirmingDelete={setConfirmingDelete}
        onClose={closeEditor}
        onSave={saveTask}
        onDelete={deleteTask}
        date={selectedDate}
      />
    </View>
  );
}

function TaskRow({
  instance,
  last,
  onEdit,
  onToggle,
  onReschedule,
}: {
  instance: TaskInstance;
  last: boolean;
  onEdit: () => void;
  onToggle: () => void;
  onReschedule: (deltaMinutes: number) => void;
}) {
  const { task, completed } = instance;
  const category = CATEGORIES[task.category];
  const canDrag = Boolean(task.time && !task.recurrence && !completed);
  const [dragging, setDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const dragResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => canDrag,
    onMoveShouldSetPanResponder: (_, gesture) => canDrag && Math.abs(gesture.dy) > 3,
    onPanResponderGrant: () => {
      setDragging(true);
      setDragOffset(0);
    },
    onPanResponderMove: (_, gesture) => setDragOffset(gesture.dy),
    onPanResponderRelease: (_, gesture) => {
      setDragging(false);
      setDragOffset(0);
      const steps = Math.round(gesture.dy / 82);
      if (steps !== 0) onReschedule(steps * 30);
    },
    onPanResponderTerminate: () => {
      setDragging(false);
      setDragOffset(0);
    },
  }), [canDrag, onReschedule]);

  return (
    <View style={styles.taskRow}>
      <View style={styles.taskTimeRail}>
        <Text style={styles.taskTime}>{formatTime(task.time)}</Text>
        <View style={styles.timelineMarkerWrap}>
          <View style={[styles.timelineMarker, completed && styles.timelineMarkerDone]} />
          {!last && <View style={styles.timelineLine} />}
        </View>
      </View>
      <View style={[
        styles.taskCard,
        completed && styles.taskCardCompleted,
        dragging && styles.taskCardDragging,
        dragging && { transform: [{ translateY: dragOffset }] },
      ]}>
        <Pressable onPress={onEdit} style={({ pressed }) => [styles.taskMain, pressed && styles.taskMainPressed]}>
          <View style={[styles.categoryTile, { backgroundColor: category.tile }]}>
            <Ionicons name={category.icon} size={19} color={category.iconColor} />
          </View>
          <View style={styles.taskTextWrap}>
            <Text numberOfLines={1} style={[styles.taskTitle, completed && styles.taskTitleCompleted]}>{task.title}</Text>
            <Text numberOfLines={1} style={styles.taskMeta}>
              {category.label} · {task.duration} min{completed ? ' · Done' : task.recurrence ? ' · Repeats' : ''}
            </Text>
          </View>
        </Pressable>
        {canDrag && (
          <View
            {...dragResponder.panHandlers}
            style={[styles.dragHandle, dragging && styles.dragHandleActive]}
            accessibilityRole="button"
            accessibilityLabel={`Drag to shift ${task.title} by 30 minutes`}
          >
            <Ionicons name="reorder-two-outline" size={19} color={dragging ? COLORS.brand : COLORS.muted} />
          </View>
        )}
        <Pressable
          onPress={onToggle}
          style={({ pressed }) => [styles.checkButton, completed && styles.checkButtonDone, pressed && styles.checkButtonPressed]}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: completed }}
          accessibilityLabel={`${completed ? 'Mark incomplete' : 'Mark done'}: ${task.title}`}
        >
          {completed && <Ionicons name="checkmark" size={16} color={COLORS.card} />}
        </Pressable>
      </View>
    </View>
  );
}

function TaskEditor({
  visible,
  draft,
  setDraft,
  editing,
  error,
  confirmingDelete,
  onSetConfirmingDelete,
  onClose,
  onSave,
  onDelete,
  date,
}: {
  visible: boolean;
  draft: DraftTask;
  setDraft: React.Dispatch<React.SetStateAction<DraftTask>>;
  editing: boolean;
  error: string;
  confirmingDelete: boolean;
  onSetConfirmingDelete: (value: boolean) => void;
  onClose: () => void;
  onSave: () => void;
  onDelete: () => void;
  date: string;
}) {
  const [previewVisible, setPreviewVisible] = useState(false);

  const parsedPreviewTime = parseTimeInput(draft.timeInput);
  const previewTime = parsedPreviewTime === undefined ? null : parsedPreviewTime;
  const previewTask: DaybookTask = {
    id: 'preview',
    title: draft.title.trim() || 'Untitled task',
    date,
    time: previewTime,
    duration: draft.duration,
    category: draft.category,
    reminderMinutes: draft.timeInput.trim() ? draft.reminderMinutes : null,
    recurrence: recurrenceFromDraft(draft),
    createdAt: Date.now(),
  };

  const patchDraft = (patch: Partial<DraftTask>) => setDraft((current) => ({ ...current, ...patch }));
  const toggleWeekday = (weekday: number) => {
    const selected = draft.weekdays.includes(weekday);
    patchDraft({ weekdays: selected ? draft.weekdays.filter((day) => day !== weekday) : [...draft.weekdays, weekday] });
  };

  return (
    <>
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.modalRoot}>
        <Pressable style={styles.modalBackdrop} onPress={onClose} accessibilityLabel="Close task editor" />
        <KeyboardAvoidingView
          style={styles.keyboardSheetWrap}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 6 : 0}
        >
          <View style={styles.editorSheet}>
            <View style={styles.sheetGrip} />
            <View style={styles.sheetHeader}>
              <View>
                <TinyLabel>{editing ? 'MAKE A CHANGE' : 'QUICK CAPTURE'}</TinyLabel>
                <Text style={styles.sheetTitle}>{editing ? 'Edit task' : 'Add a task'}</Text>
              </View>
              <Pressable onPress={onClose} style={styles.closeButton} accessibilityRole="button" accessibilityLabel="Close">
                <Ionicons name="close" size={21} color={COLORS.ink} />
              </Pressable>
            </View>
            <ScrollView
              style={styles.editorScroll}
              contentContainerStyle={styles.editorContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.editorDatePill}>
                <Ionicons name="calendar-outline" size={14} color={COLORS.brand} />
                <Text style={styles.editorDateText}>{formatDateLong(date)}</Text>
              </View>

              <Text style={styles.fieldLabel}>What’s on your mind?</Text>
              <TextInput
                value={draft.title}
                onChangeText={(title) => patchDraft({ title })}
                style={styles.titleInput}
                placeholder="e.g. Pick up groceries"
                placeholderTextColor="#9A9291"
                maxLength={100}
                returnKeyType="next"
                autoFocus={Platform.OS !== 'web'}
                accessibilityLabel="Task name"
              />

              <View style={styles.twoColumnFields}>
                <View style={styles.halfField}>
                  <Text style={styles.fieldLabel}>Time <Text style={styles.optionalText}>· optional</Text></Text>
                  <View style={styles.fieldInputWrap}>
                    <Ionicons name="time-outline" size={17} color={COLORS.muted} />
                    <TextInput
                      value={draft.timeInput}
                      onChangeText={(timeInput) => patchDraft({ timeInput, reminderMinutes: timeInput.trim() ? draft.reminderMinutes : null })}
                      style={styles.inlineInput}
                      placeholder="9:30 AM"
                      placeholderTextColor="#9A9291"
                      keyboardType="numbers-and-punctuation"
                      returnKeyType="done"
                      accessibilityLabel="Optional time"
                    />
                  </View>
                </View>
                <View style={styles.halfField}>
                  <Text style={styles.fieldLabel}>Duration</Text>
                  <View style={styles.fieldInputWrap}>
                    <Ionicons name="hourglass-outline" size={16} color={COLORS.muted} />
                    <Text style={styles.durationValue}>{draft.duration} min</Text>
                  </View>
                </View>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.durationChoices}>
                {DURATION_OPTIONS.map((duration) => (
                  <ChoiceChip
                    key={duration}
                    label={`${duration}m`}
                    selected={draft.duration === duration}
                    onPress={() => patchDraft({ duration })}
                  />
                ))}
              </ScrollView>

              <Text style={styles.fieldLabel}>Category</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryChoices}>
                {(Object.keys(CATEGORIES) as Category[]).map((categoryKey) => {
                  const category = CATEGORIES[categoryKey];
                  const selected = draft.category === categoryKey;
                  return (
                    <Pressable
                      key={categoryKey}
                      onPress={() => patchDraft({ category: categoryKey })}
                      style={[styles.categoryChoice, selected && styles.categoryChoiceSelected]}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                    >
                      <View style={[styles.categoryChoiceIcon, { backgroundColor: category.tile }]}>
                        <Ionicons name={category.icon} size={15} color={category.iconColor} />
                      </View>
                      <Text style={[styles.categoryChoiceText, selected && styles.categoryChoiceTextSelected]}>{category.label}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>

              <View style={styles.sectionLabelRow}>
                <Text style={styles.fieldLabel}>Reminder</Text>
                {!draft.timeInput.trim() && <Text style={styles.optionalText}>Add a time first</Text>}
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>
                {REMINDER_OPTIONS.map((option) => (
                  <ChoiceChip
                    key={option.label}
                    label={option.label}
                    selected={draft.reminderMinutes === option.value}
                    onPress={() => {
                      if (option.value !== null && !draft.timeInput.trim()) {
                        patchDraft({ timeInput: '9:00 AM', reminderMinutes: option.value });
                      } else {
                        patchDraft({ reminderMinutes: option.value });
                      }
                    }}
                  />
                ))}
              </ScrollView>

              <Text style={styles.fieldLabel}>Repeat</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>
                {REPEAT_OPTIONS.map((option) => (
                  <ChoiceChip
                    key={option.value}
                    label={option.label}
                    selected={draft.repeat === option.value}
                    onPress={() => patchDraft({
                      repeat: option.value,
                      weekdays: option.value === 'custom' && draft.weekdays.length === 0
                        ? [parseISODate(date).getDay()]
                        : draft.weekdays,
                    })}
                  />
                ))}
              </ScrollView>

              {draft.repeat === 'custom' && (
                <View style={styles.weekdayPicker}>
                  {WEEKDAYS.map((weekday, index) => {
                    const selected = draft.weekdays.includes(index);
                    return (
                      <Pressable
                        key={`${weekday}-${index}`}
                        onPress={() => toggleWeekday(index)}
                        style={[styles.weekdayChoice, selected && styles.weekdayChoiceSelected]}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        accessibilityLabel={formatWeekdayForIndex(index)}
                      >
                        <Text style={[styles.weekdayChoiceText, selected && styles.weekdayChoiceTextSelected]}>{weekday}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}

              {error.length > 0 && <Text style={styles.formError}>{error}</Text>}

              {editing && (
                confirmingDelete ? (
                  <View style={styles.deleteConfirm}>
                    <Text style={styles.deleteConfirmText}>Delete this task and its routine?</Text>
                    <View style={styles.deleteConfirmButtons}>
                      <Pressable onPress={() => onSetConfirmingDelete(false)} style={styles.cancelDeleteButton}>
                        <Text style={styles.cancelDeleteText}>Keep it</Text>
                      </Pressable>
                      <Pressable onPress={onDelete} style={styles.confirmDeleteButton}>
                        <Text style={styles.confirmDeleteText}>Delete</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  <Pressable onPress={() => onSetConfirmingDelete(true)} style={styles.deleteLink}>
                    <Ionicons name="trash-outline" size={16} color={COLORS.danger} />
                    <Text style={styles.deleteLinkText}>Delete task</Text>
                  </Pressable>
                )
              )}

              <Pressable onPress={() => setPreviewVisible(true)} style={({ pressed }) => [styles.previewButton, pressed && styles.pressed]}>
                <Ionicons name="eye-outline" size={17} color={COLORS.brand} />
                <Text style={styles.previewButtonText}>Preview task</Text>
              </Pressable>

              <Pressable style={({ pressed }) => [styles.saveButton, pressed && styles.primaryButtonPressed]} onPress={onSave}>
                <Text style={styles.saveButtonText}>{editing ? 'Save changes' : 'Add to my day'}</Text>
                <Ionicons name="arrow-forward" size={17} color={COLORS.card} />
              </Pressable>
              <Text style={styles.editorFootnote}>Just for you. Saved on this device.</Text>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>

    <Modal visible={previewVisible} transparent animationType="fade" onRequestClose={() => setPreviewVisible(false)}>
      <View style={styles.previewModalRoot}>
        <Pressable style={styles.modalBackdrop} onPress={() => setPreviewVisible(false)} accessibilityLabel="Close preview" />
        <View style={styles.previewCard}>
          <View style={styles.sheetHeader}>
            <View>
              <TinyLabel>PREVIEW</TinyLabel>
              <Text style={styles.sheetTitle}>How it looks</Text>
            </View>
            <Pressable onPress={() => setPreviewVisible(false)} style={styles.closeButton} accessibilityRole="button" accessibilityLabel="Close preview">
              <Ionicons name="close" size={21} color={COLORS.ink} />
            </Pressable>
          </View>
          <TaskRow
            instance={{ task: previewTask, date, completed: false }}
            last
            onEdit={() => undefined}
            onToggle={() => undefined}
            onReschedule={() => undefined}
          />
          <Text style={styles.editorFootnote}>Preview only — not saved yet.</Text>
        </View>
      </View>
    </Modal>
    </>
  );
}

function formatWeekdayForIndex(index: number): string {
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][index];
}

function ChoiceChip({
  label,
  selected,
  disabled = false,
  onPress,
}: {
  label: string;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.choiceChip, selected && styles.choiceChipSelected, disabled && styles.choiceChipDisabled]}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
    >
      <Text style={[styles.choiceChipText, selected && styles.choiceChipTextSelected, disabled && styles.choiceChipTextDisabled]}>{label}</Text>
    </Pressable>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  outerShell: {
    flex: 1,
    backgroundColor: COLORS.backdrop,
    alignItems: 'center',
  },
  safeArea: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
  },
  appFrame: {
    flex: 1,
    width: '100%',
    maxWidth: 480,
    backgroundColor: COLORS.surface,
    overflow: 'hidden',
    position: 'relative',
    ...(Platform.OS === 'web' ? { borderRadius: 28, marginVertical: 24, boxShadow: '0 16px 50px rgba(61, 37, 32, 0.12)' } as object : {}),
  },
  scrollView: { flex: 1 },
  pageContent: {
    paddingHorizontal: 21,
    paddingTop: 14,
    paddingBottom: 116,
  },
  loadingScreen: {
    flex: 1,
    backgroundColor: COLORS.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingMark: {
    width: 54,
    height: 54,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.peach,
    marginBottom: 14,
  },
  loadingText: { color: COLORS.ink, fontFamily: FONT.semibold, fontSize: 17 },
  loader: { marginTop: 15 },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 22,
  },
  brandLockup: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  brandMark: {
    width: 29,
    height: 29,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.brand,
  },
  brandName: { color: COLORS.ink, fontFamily: FONT.bold, fontSize: 19, letterSpacing: -0.4 },
  localBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#F1E9E5',
    borderRadius: 20,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  localBadgeText: { fontFamily: FONT.bold, color: COLORS.muted, fontSize: 9, letterSpacing: 0.7 },
  heroBlock: { marginBottom: 20 },
  heroTitle: { color: COLORS.ink, fontFamily: FONT.semibold, fontSize: 29, lineHeight: 34, letterSpacing: -0.7 },
  heroSubtitle: { color: COLORS.muted, fontFamily: FONT.medium, fontSize: 15, lineHeight: 21, marginTop: 3 },
  tinyLabel: { color: COLORS.muted, fontFamily: FONT.bold, fontSize: 10, lineHeight: 14, letterSpacing: 1.05 },
  dateHeadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  dateHeadingCopy: { flex: 1, paddingRight: 8 },
  dateHeadingTitle: { color: COLORS.ink, fontFamily: FONT.semibold, fontSize: 18, lineHeight: 23, marginTop: 2 },
  dateRange: { color: COLORS.muted, fontFamily: FONT.medium, fontSize: 12, marginTop: 1 },
  dateControls: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  arrowButton: { width: 34, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  todayButton: { backgroundColor: COLORS.card, paddingHorizontal: 11, paddingVertical: 8, borderRadius: 18, marginHorizontal: 2 },
  todayButtonText: { color: COLORS.brand, fontFamily: FONT.semibold, fontSize: 12 },
  pressed: { opacity: 0.7 },
  dateStrip: {
    minWidth: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 2,
  },
  dateOption: { width: 44, alignItems: 'center', justifyContent: 'center', paddingVertical: 2 },
  dateWeekday: { color: COLORS.muted, fontFamily: FONT.semibold, fontSize: 11, marginBottom: 5 },
  dateWeekdaySelected: { color: COLORS.ink },
  dateCircle: { width: 39, height: 39, borderRadius: 20, backgroundColor: COLORS.card, alignItems: 'center', justifyContent: 'center' },
  dateCircleSelected: { backgroundColor: COLORS.ink },
  dateNumber: { color: COLORS.ink, fontFamily: FONT.semibold, fontSize: 14 },
  dateNumberSelected: { color: COLORS.card },
  dateTaskDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: 'transparent', marginTop: 3 },
  dateTaskDotVisible: { backgroundColor: COLORS.accent },
  dateTaskDotSelected: { backgroundColor: COLORS.peach },
  modeSwitch: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    backgroundColor: '#EFE7E4',
    borderRadius: 22,
    padding: 3,
    marginTop: 15,
    marginBottom: 19,
  },
  modeButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 15, paddingVertical: 8, minWidth: 82, borderRadius: 19 },
  modeButtonSelected: { backgroundColor: COLORS.brand },
  modeButtonText: { color: COLORS.muted, fontFamily: FONT.semibold, fontSize: 13 },
  modeButtonTextSelected: { color: COLORS.card },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#F1E8E1', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 13, marginBottom: 14 },
  noticeText: { flex: 1, color: COLORS.ink, fontFamily: FONT.medium, fontSize: 13 },
  daySummary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 13 },
  summaryCopy: { gap: 2 },
  summaryTitle: { color: COLORS.ink, fontFamily: FONT.semibold, fontSize: 18, lineHeight: 23 },
  summaryProgressWrap: { width: 80, alignItems: 'flex-end', gap: 5 },
  summaryPercent: { color: COLORS.brand, fontFamily: FONT.bold, fontSize: 12 },
  progressTrack: { width: 76, height: 4, borderRadius: 4, backgroundColor: '#E9DEDA', overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: COLORS.accent, borderRadius: 4 },
  dragHint: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: -7, marginBottom: 11 },
  dragHintText: { color: COLORS.muted, fontFamily: FONT.medium, fontSize: 11 },
  reminderCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.peach, borderRadius: 15, padding: 13, marginBottom: 15 },
  reminderIconWrap: { width: 38, height: 38, backgroundColor: 'rgba(255,255,255,0.62)', borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginRight: 11 },
  reminderCopy: { flex: 1, minWidth: 0 },
  reminderEyebrow: { color: COLORS.brand, fontSize: 9, letterSpacing: 0.9 },
  reminderTitle: { color: COLORS.ink, fontFamily: FONT.semibold, fontSize: 15, marginTop: 2 },
  reminderNote: { color: '#70574A', fontFamily: FONT.medium, fontSize: 11, marginTop: 2 },
  snoozeButton: { width: 36, height: 36, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.72)', marginLeft: 8 },
  emptyCard: { alignItems: 'center', backgroundColor: COLORS.card, borderRadius: 18, paddingHorizontal: 25, paddingVertical: 25, marginTop: 5 },
  emptyIcon: { width: 52, height: 52, borderRadius: 17, backgroundColor: COLORS.peach, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  emptyTitle: { color: COLORS.ink, fontFamily: FONT.semibold, fontSize: 19, textAlign: 'center' },
  emptyBody: { maxWidth: 265, color: COLORS.muted, fontFamily: FONT.medium, fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 5, marginBottom: 17 },
  primaryButton: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 7, minHeight: 46, paddingHorizontal: 20, borderRadius: 24, backgroundColor: COLORS.brand },
  primaryButtonPressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  primaryButtonText: { color: COLORS.card, fontFamily: FONT.semibold, fontSize: 14 },
  taskList: { marginTop: 5 },
  taskRow: { flexDirection: 'row', minHeight: 85 },
  taskTimeRail: { position: 'relative', width: 66, alignItems: 'flex-start', paddingTop: 13 },
  taskTime: { width: 64, color: COLORS.muted, fontFamily: FONT.medium, fontSize: 11 },
  timelineMarkerWrap: { position: 'absolute', top: 38, left: 0, width: 12, height: '100%', alignItems: 'center' },
  timelineMarker: { width: 9, height: 9, borderRadius: 5, borderWidth: 1.5, borderColor: COLORS.brand, backgroundColor: COLORS.surface, zIndex: 1 },
  timelineMarkerDone: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  timelineLine: { position: 'absolute', top: 10, bottom: 0, width: 1, backgroundColor: '#DED1CD' },
  taskCard: { flex: 1, minHeight: 72, flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.card, borderRadius: 15, paddingHorizontal: 11, paddingVertical: 11, marginBottom: 10 },
  taskCardCompleted: { backgroundColor: '#FBF8F7' },
  taskCardDragging: { zIndex: 5, backgroundColor: '#FFF9F4' },
  taskMain: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 },
  taskMainPressed: { opacity: 0.75 },
  categoryTile: { width: 41, height: 41, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  taskTextWrap: { flex: 1, minWidth: 0, paddingRight: 6 },
  taskTitle: { color: COLORS.ink, fontFamily: FONT.semibold, fontSize: 15, lineHeight: 19 },
  taskTitleCompleted: { color: '#777176', textDecorationLine: 'line-through' },
  taskMeta: { color: COLORS.muted, fontFamily: FONT.medium, fontSize: 11, lineHeight: 15, marginTop: 3 },
  dragHandle: { width: 26, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginRight: 4 },
  dragHandleActive: { backgroundColor: COLORS.peach },
  checkButton: { width: 25, height: 25, borderRadius: 13, borderWidth: 1.5, borderColor: '#A99D98', alignItems: 'center', justifyContent: 'center', marginLeft: 3 },
  checkButtonDone: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  checkButtonPressed: { opacity: 0.65, transform: [{ scale: 0.93 }] },
  rolloverCard: { backgroundColor: '#F0E9E4', borderRadius: 15, padding: 14, marginTop: 13 },
  rolloverIcon: { width: 35, height: 35, borderRadius: 12, backgroundColor: COLORS.card, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  rolloverCopy: { marginBottom: 11 },
  rolloverTitle: { color: COLORS.ink, fontFamily: FONT.semibold, fontSize: 15 },
  rolloverText: { color: COLORS.muted, fontFamily: FONT.medium, fontSize: 12, marginTop: 3 },
  rolloverAction: { alignSelf: 'flex-start', flexDirection: 'row', gap: 7, alignItems: 'center', backgroundColor: COLORS.card, borderRadius: 18, paddingHorizontal: 12, paddingVertical: 8 },
  rolloverActionText: { color: COLORS.brand, fontFamily: FONT.semibold, fontSize: 12 },
  weekSummaryCard: { backgroundColor: COLORS.peach, borderRadius: 16, padding: 16, marginBottom: 15 },
  weekSummaryTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  weekSummaryTitle: { color: COLORS.ink, fontFamily: FONT.semibold, fontSize: 18, marginTop: 3 },
  weekSummarySub: { color: '#70574A', fontFamily: FONT.medium, fontSize: 12, marginTop: 2 },
  weekSummaryIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.68)', alignItems: 'center', justifyContent: 'center' },
  weekProgressTrack: { height: 4, borderRadius: 5, backgroundColor: 'rgba(94,42,14,0.14)', marginTop: 14, overflow: 'hidden' },
  weekProgressFill: { height: '100%', borderRadius: 5, backgroundColor: COLORS.brand },
  weekDaysList: { gap: 9 },
  weekDayCard: { minHeight: 76, flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.card, borderRadius: 15, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: 'transparent' },
  weekDayCardSelected: { borderColor: '#D8C5BA' },
  weekDayInfo: { width: 91, flexDirection: 'row', alignItems: 'center', gap: 9 },
  weekDayDate: { width: 36, height: 36, borderRadius: 13, backgroundColor: '#F2EBE8', alignItems: 'center', justifyContent: 'center' },
  weekDayDateSelected: { backgroundColor: COLORS.brand },
  weekDayNumber: { color: COLORS.ink, fontFamily: FONT.semibold, fontSize: 14 },
  weekDayNumberSelected: { color: COLORS.card },
  weekDayText: { flex: 1 },
  weekDayName: { color: COLORS.ink, fontFamily: FONT.semibold, fontSize: 12 },
  weekDayMonth: { color: COLORS.muted, fontFamily: FONT.medium, fontSize: 10, marginTop: 1 },
  weekDayPreview: { flex: 1, paddingHorizontal: 6, minWidth: 0 },
  weekPreviewTitle: { color: COLORS.ink, fontFamily: FONT.medium, fontSize: 12 },
  weekPreviewMore: { color: COLORS.muted, fontFamily: FONT.medium, fontSize: 10, marginTop: 2 },
  weekPreviewEmpty: { color: '#8E8582', fontFamily: FONT.medium, fontSize: 11 },
  weekDayCount: { width: 37, alignItems: 'flex-end', justifyContent: 'center' },
  weekDayCountText: { color: COLORS.muted, fontFamily: FONT.semibold, fontSize: 10 },
  weekTinyProgress: { width: 27, height: 3, backgroundColor: '#E9DEDA', borderRadius: 4, marginTop: 4, overflow: 'hidden' },
  weekTinyProgressFill: { height: '100%', backgroundColor: COLORS.accent, borderRadius: 4 },
  footerNote: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 23, marginBottom: 4 },
  footerNoteText: { color: COLORS.muted, fontFamily: FONT.medium, fontSize: 11 },
  addButton: { position: 'absolute', right: 21, bottom: 22, width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.brand, ...(Platform.OS === 'web' ? { boxShadow: '0 5px 14px rgba(94,42,14,0.22)' } as object : { elevation: 4 }) },
  addButtonPressed: { opacity: 0.86, transform: [{ scale: 0.95 }] },
  modalRoot: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'transparent' },
  previewModalRoot: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'transparent', paddingHorizontal: 20 },
  previewCard: { width: '100%', maxWidth: 420, backgroundColor: COLORS.surface, borderRadius: 22, paddingTop: 9, paddingHorizontal: 16, paddingBottom: 16, shadowColor: '#3D2520', shadowOpacity: 0.18, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 8 },
  previewButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 44, borderRadius: 22, borderWidth: 1, borderColor: COLORS.brand, marginBottom: 10, backgroundColor: COLORS.card },
  previewButtonText: { color: COLORS.brand, fontFamily: FONT.semibold, fontSize: 14 },
  modalBackdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(31,31,34,0.38)' },
  keyboardSheetWrap: { justifyContent: 'flex-end', maxHeight: '96%' },
  editorSheet: { backgroundColor: COLORS.surface, borderTopLeftRadius: 26, borderTopRightRadius: 26, maxHeight: '96%', paddingTop: 9, paddingHorizontal: 21, paddingBottom: Platform.OS === 'ios' ? 25 : 16 },
  sheetGrip: { alignSelf: 'center', width: 39, height: 4, borderRadius: 4, backgroundColor: '#D5C9C4', marginBottom: 15 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sheetTitle: { color: COLORS.ink, fontFamily: FONT.semibold, fontSize: 23, lineHeight: 28, marginTop: 1 },
  closeButton: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.card },
  editorScroll: { flexGrow: 0 },
  editorContent: { paddingBottom: 15 },
  editorDatePill: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#EFE7E3', borderRadius: 15, paddingHorizontal: 10, paddingVertical: 7, marginBottom: 15 },
  editorDateText: { color: COLORS.brand, fontFamily: FONT.medium, fontSize: 11 },
  fieldLabel: { color: COLORS.ink, fontFamily: FONT.semibold, fontSize: 13, marginBottom: 7 },
  optionalText: { color: COLORS.muted, fontFamily: FONT.regular, fontSize: 11 },
  titleInput: { height: 50, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.line, borderRadius: 13, paddingHorizontal: 13, color: COLORS.ink, fontFamily: FONT.medium, fontSize: 15, marginBottom: 13, outlineStyle: 'none' as never },
  twoColumnFields: { flexDirection: 'row', gap: 10 },
  halfField: { flex: 1 },
  fieldInputWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 43, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.line, borderRadius: 12, paddingHorizontal: 10 },
  inlineInput: { flex: 1, color: COLORS.ink, fontFamily: FONT.medium, fontSize: 13, height: 42, padding: 0, outlineStyle: 'none' as never },
  durationValue: { color: COLORS.ink, fontFamily: FONT.medium, fontSize: 13 },
  durationChoices: { gap: 7, paddingTop: 8, paddingBottom: 15 },
  choiceRow: { gap: 7, paddingBottom: 14 },
  choiceChip: { minHeight: 35, paddingHorizontal: 12, borderRadius: 18, borderWidth: 1, borderColor: '#E4DAD6', alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.card },
  choiceChipSelected: { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  choiceChipDisabled: { opacity: 0.42 },
  choiceChipText: { color: COLORS.ink, fontFamily: FONT.medium, fontSize: 12 },
  choiceChipTextSelected: { color: COLORS.card, fontFamily: FONT.semibold },
  choiceChipTextDisabled: { color: COLORS.muted },
  categoryChoices: { gap: 7, paddingBottom: 15 },
  categoryChoice: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 37, backgroundColor: COLORS.card, borderWidth: 1, borderColor: 'transparent', borderRadius: 19, paddingHorizontal: 8, paddingRight: 10 },
  categoryChoiceSelected: { borderColor: COLORS.brand },
  categoryChoiceIcon: { width: 24, height: 24, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  categoryChoiceText: { color: COLORS.muted, fontFamily: FONT.medium, fontSize: 11 },
  categoryChoiceTextSelected: { color: COLORS.brand, fontFamily: FONT.semibold },
  sectionLabelRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  weekdayPicker: { flexDirection: 'row', justifyContent: 'space-between', paddingBottom: 15, paddingTop: 1 },
  weekdayChoice: { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.card, alignItems: 'center', justifyContent: 'center' },
  weekdayChoiceSelected: { backgroundColor: COLORS.ink },
  weekdayChoiceText: { color: COLORS.muted, fontFamily: FONT.semibold, fontSize: 12 },
  weekdayChoiceTextSelected: { color: COLORS.card },
  formError: { color: COLORS.danger, fontFamily: FONT.medium, fontSize: 12, marginBottom: 10 },
  saveButton: { flexDirection: 'row', minHeight: 48, alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: COLORS.brand, borderRadius: 25, marginTop: 1 },
  saveButtonText: { color: COLORS.card, fontFamily: FONT.semibold, fontSize: 14 },
  editorFootnote: { color: COLORS.muted, fontFamily: FONT.regular, fontSize: 10, textAlign: 'center', marginTop: 9 },
  deleteLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 36, marginBottom: 5 },
  deleteLinkText: { color: COLORS.danger, fontFamily: FONT.semibold, fontSize: 12 },
  deleteConfirm: { backgroundColor: '#F4EAE6', borderRadius: 13, padding: 12, marginBottom: 9 },
  deleteConfirmText: { color: COLORS.ink, fontFamily: FONT.semibold, fontSize: 13, textAlign: 'center', marginBottom: 9 },
  deleteConfirmButtons: { flexDirection: 'row', justifyContent: 'center', gap: 9 },
  cancelDeleteButton: { paddingHorizontal: 15, paddingVertical: 8, borderRadius: 18, backgroundColor: COLORS.card },
  cancelDeleteText: { color: COLORS.ink, fontFamily: FONT.semibold, fontSize: 12 },
  confirmDeleteButton: { paddingHorizontal: 15, paddingVertical: 8, borderRadius: 18, backgroundColor: COLORS.danger },
  confirmDeleteText: { color: COLORS.card, fontFamily: FONT.semibold, fontSize: 12 },
});
