# Daybook

A calm, local-first daily planner built from the Daybook v1 PRD. Capture a task, see it on one timeline, and make a little room when plans change.

## Run it

```sh
npm install
npm run web       # browser preview
npm start         # Expo development server
npm run ios       # open the iOS simulator (macOS required)
npm run android   # open an Android emulator
npm run typecheck
```

Scan the Expo Go QR code to try the native app on a device. Local reminders and notification actions require notification permission on iOS or Android. The browser build is a preview: it saves to browser local storage and does not deliver operating-system notifications.

## What’s included

- Day timeline with a quick-add/edit flow, optional 24-hour or AM/PM time entry, duration, and task categories.
- Week overview and date navigation.
- One-time, daily, weekly, and chosen-weekday recurrence.
- Local reminders with notification actions to mark a task done or snooze it for ten minutes.
- A one-tap rollover for unfinished one-off tasks.
- Completion tracking per date, including separate completion states for recurring tasks.
- Urbanist typography, warm palette, and responsive phone-first layout.

## Storage and privacy

There is no account or backend. iOS and Android persist the task state in a SQLite-backed store (`expo-sqlite/kv-store`); the web preview uses `localStorage`. Nothing is synced or shared.
