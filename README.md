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

- Day timeline with a quick-add/edit flow, an optional 15-minute time dropdown, duration, and task categories.
- A task preview before saving, plus a validated sign-up screen prototype reachable from the app header.
- Week overview and date navigation.
- One-time, daily, weekly, and chosen-weekday recurrence.
- Local reminders with notification actions to mark a task done or snooze it for ten minutes.
- A one-tap rollover for unfinished one-off tasks.
- Completion tracking per date, including separate completion states for recurring tasks.
- Urbanist typography, warm palette, and responsive phone-first layout.

## Storage and privacy

There is no authentication service or backend. The sign-up screen is a validated UI prototype only: it does not send or persist email/password credentials, and the temporary profile name lasts only for the current app session. iOS and Android persist task state in a SQLite-backed store (`expo-sqlite/kv-store`); the web preview uses `localStorage`. Tasks stay on this device and are not synced or shared.
