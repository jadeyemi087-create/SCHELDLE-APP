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

Scan the Expo Go QR code to try the native app on a device. Local reminders and notification actions require notification permission on iOS or Android. The browser build saves planner data to browser local storage and does not deliver operating-system notifications.

## Supabase Authentication setup

Account access is backed by Supabase Auth. Create a Supabase project, then:

1. In **Project Settings → API**, copy the **Project URL** and the public **anon/publishable key**. The app only needs these public client values; never use a `service_role` or other secret key in an Expo app.
2. Copy `.env.example` to `.env.local` and fill in the values:

   ```sh
   cp .env.example .env.local
   ```

   ```dotenv
   EXPO_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=your-public-anon-or-publishable-key
   ```

   Expo exposes variables prefixed with `EXPO_PUBLIC_` to the client bundle. Restart the Expo server after changing them. `.env.local` is ignored by Git.
3. In **Authentication → URL Configuration**, add the app callback URLs under **Redirect URLs**:
   - Native app / installed build: `daybook://auth/callback` (the `daybook` scheme is set in `app.json`).
   - Expo Go: add the exact callback URL generated for your running Expo Go session. It commonly looks like `exp://<dev-host>:<port>/--/auth/callback`; the host can change between sessions.
   - Web: add the app’s web origin, such as `http://localhost:8081` during local development, and the deployed web origin when applicable.

   Supabase requires redirect URLs to match its allowlist. For production builds, keep the stable `daybook://auth/callback` URL and your deployed web origin in the list.
4. In **Authentication → Providers**, enable **Email**. Choose whether email confirmation is required, then customize the confirmation and password-reset email templates if needed. The app uses the redirect URL above for confirmation, resend, and reset links. Configure a custom SMTP provider before production use; Supabase’s default mail service is intended for limited testing.
5. To enable social sign-in, enable **Google** and/or **Apple** in Supabase’s Auth providers and enter the credentials from each provider’s developer console. In those consoles, set the authorized callback/return URL to Supabase’s provider callback, typically `https://<your-project-ref>.supabase.co/auth/v1/callback` (use the exact URL shown in the Supabase provider settings). The app itself then redirects back through `daybook://auth/callback` on native or the current web origin. Apple sign-in also requires the corresponding Apple Developer identifiers and key.
6. Start the app with the configured environment:

   ```sh
   npm run web
   # or npm start, then open it in Expo Go / a development build
   ```

The account screen includes email/password sign-up and login, confirmation-email resend, password-reset email and new-password screens, plus Google and Apple OAuth. Supabase Auth persists the session on the device. Signing out ends the auth session but does not delete planner data.

## What’s included

- Day timeline with a quick-add/edit flow, an optional 15-minute time dropdown, duration, and task categories.
- Supabase email/password account access, email verification and resend, password recovery, and Google/Apple OAuth.
- Week overview and date navigation.
- One-time, daily, weekly, and chosen-weekday recurrence.
- Local reminders with notification actions to mark a task done or snooze it for ten minutes.
- A one-tap rollover for unfinished one-off tasks.
- Completion tracking per date, including separate completion states for recurring tasks.
- Urbanist typography, warm palette, and responsive phone-first layout.

## Storage and privacy

Authentication is only for account identity; it does **not** sync planner data. Tasks, completions, and reminders remain in this installation’s local store: SQLite-backed storage on iOS/Android and `localStorage` on web. Signing in on another device will not bring those tasks over, and signing out leaves local tasks in place. Supabase stores the account and auth metadata needed for authentication; this app does not write planner tasks to Supabase.
