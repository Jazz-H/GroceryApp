# Stocked

A shared grocery list for two phones (Android + iPhone) that replaces the whiteboard on the fridge. It's a free, installable web app (PWA) with Google sign-in and live sync through Firebase.

- **Fridge Board**: items handwritten in each person's marker color
- **Store pills**: Harris Teeter · Target · Amazon sub-lists
- **Aisle order**: sorts the board in the order you walk the store
- **Price and aisle per store**, with a running estimated total
- **Grocery** and **Nice-to-have** lists
- **Activity log** of every change, with multi-item adds grouped
- **Trips**: shopping together (shared live check-off) or solo (partner sees a banner)
- **Notifications** when your partner starts a trip or adds groceries
- Works **offline** in the store and syncs when signal comes back
- **Usuals**: one-tap chips for things you buy regularly that aren't on the list, timed to how often you buy them. Re-adding something brings back its prices and aisles
- **Undo** for 6 seconds after removing items or clearing checked ones
- **Target pickup**: build the order with Find links into Target, mark items Added, then **Order placed** keeps them under "Ordered for pickup" until **Picked up**
- **Price history** in each item: what you paid at each store, and which was cheapest last time
- **Receipts → spending**: ending a trip offers to add its receipt. Snap a receipt, black out card info, and Gemini reads it. Matched items get the price you actually paid and are checked off. The **Spend** tab shows monthly totals, a budget, spending by store and by person, and a CSV export

Planning docs: [discovery plan](docs/discovery-plan.md) · [design concepts](docs/design-concepts.html)

---

## Try it locally (no Firebase account needed)

Needs Node 20+ and Java 11+ (for the Firebase emulators).

```bash
npm install
npm run emulators      # terminal 1: local Auth + Firestore
npm run dev:local      # terminal 2: app at http://localhost:5173
```

The sign-in page shows a **Local test account** form when running against the emulators. Open a second browser window (or a private window), sign in as a different test user, and join with the invite code from Settings to see two-person sync.

## Put it on your phones (free, about 15 minutes)

The detailed walkthrough, with a message to send your partner, is in [docs/GO-LIVE.md](docs/GO-LIVE.md).

Everything here runs on Firebase's free **Spark** plan. No credit card is needed.

1. **Create a Firebase project** at <https://console.firebase.google.com>. Name it something like `fridgeboard-yourname`. Analytics isn't needed.
2. **Turn on Google sign-in:** Build → Authentication → Get started → Sign-in method → Google → Enable.
3. **Create the database:** Build → Firestore Database → Create database → Production mode → pick `us-east1` (closest to Charlotte).
4. **Register a web app:** Project settings (gear) → Your apps → `</>` Web. Copy the config values.
5. **Configure this repo:**
   ```bash
   cp .env.example .env.local
   ```
   Fill in the values. Set `VITE_FIREBASE_AUTH_DOMAIN` to **`<project-id>.web.app`**, not the default `firebaseapp.com`. Sign-in then happens on the app's own domain, which iPhone home-screen apps need.
   Then allow that address for Google sign-in: in [Google Cloud → Credentials](https://console.cloud.google.com/apis/credentials), open **Web client (auto created by Google Service)** and add `https://<project-id>.web.app/__/auth/handler` under **Authorized redirect URIs**.
6. **Deploy:**
   ```bash
   npx firebase login
   npx firebase use --add          # pick your project
   npm run deploy                  # builds, then deploys the app + security rules
   ```
7. **Install on each phone:** open `https://<project-id>.web.app`.
   - **iPhone (Safari):** Share → **Add to Home Screen**, then open it from the new icon and sign in **there**, not in Safari.
   - **Android (Chrome):** ⋮ menu → **Install app**.
8. **Connect your accounts:** one of you taps **Create household**. The other taps **Join with a code** and enters the code from Settings → Invite.
9. **Turn on receipt reading (optional):** in the Firebase console, open **AI Logic → Get started** and pick the **Gemini Developer API**. It's free and needs no credit card. Then redeploy. Without this step, receipts can still be typed in by hand.

   Against the local emulators there's no Gemini, so **Read receipt** returns a sample Harris Teeter receipt to test with.

   Privacy: photos are never stored. Black boxes you draw are burned into the image before it's sent to Gemini. Google may use data sent to the free tier to improve its products.

## Notifications (free, about 10 more minutes)

Notifications go through a tiny relay on Cloudflare Workers' free plan, in `worker/`. It has no Google credentials. It reads your household and its phone subscriptions using the sender's own sign-in, so the same security rules apply. It also:

- writes the notification text itself, so phones can't send each other arbitrary messages;
- only notifies current members;
- skips phones that are snoozed or in quiet hours;
- limits how many notifications one person can send in 10 minutes.

1. **Make keys:** `npm run vapid`. It prints a public key and a private key.
2. **Set up the relay:** create a free account at <https://dash.cloudflare.com/sign-up>. In `worker/wrangler.toml`, check `FIREBASE_PROJECT_ID` (your project id) and `ALLOWED_ORIGINS` (`https://<project-id>.web.app`).
3. **Deploy it:**
   ```bash
   cd worker
   npx wrangler@4 login
   npx wrangler@4 secret put VAPID_PRIVATE_KEY   # paste the private key
   npx wrangler@4 deploy --var VAPID_PUBLIC_KEY:<the public key>
   # prints https://fridgeboard-push.<you>.workers.dev
   ```
   The public key and `VAPID_SUBJECT` (optional: `mailto:` plus an email; it defaults to the app's URL) live as variables in the Cloudflare dashboard, not in `wrangler.toml`. `keep_vars = true` stops later deploys from wiping them. Check it with `https://fridgeboard-push.<you>.workers.dev/health`: it should say `"configured":true`.
4. **Point the app at it:** in `.env.local`, set `VITE_VAPID_PUBLIC_KEY` (the public key) and `VITE_PUSH_URL` (the Worker URL). Then run `npm run deploy` again.
5. **On each phone:** Settings → Notifications → **Turn on notifications**, then **Send me a test**.
   - **iPhone:** needs iOS 16.4 or later, and only works from the Home Screen app.
   - **Android:** works in Chrome, installed or not.

What you'll get:

| When                         | Notification                                                                      |
| ---------------------------- | --------------------------------------------------------------------------------- |
| Your partner starts a trip   | “Sam is at Harris Teeter: shopping solo with 6 items. Add anything you need now.” |
| Your partner joins your trip | “Sam joined your Target trip”                                                     |
| Your partner ends a trip     | “Sam finished at Target: 14 items checked off.”                                   |
| Your partner adds groceries  | “Alex added 3 items: Eggs, Milk, Bread”. Quick adds merge into one notification   |
| A receipt is saved           | “Alex saved a Target receipt: $162.60 added to spending.”                         |
| Spending passes the budget   | “November spending passed 80% of budget”, then “November is over budget”          |

Tapping a notification opens the right screen (a trip opens that store's list; receipts open Spend). In Settings each phone can turn kinds off, snooze for an hour or until 8 AM, and set quiet hours. Settings also lists every phone that gets notifications, so either of you can remove an old one. Signing out or leaving the household stops that phone's notifications.

## Automatic deploys

Pushes to `main` are tested and deployed automatically by GitHub Actions. Pull requests run the same checks. One-time setup: [docs/AUTO-DEPLOY.md](docs/AUTO-DEPLOY.md).

## Scripts

| Command              | What it does                                               |
| -------------------- | ---------------------------------------------------------- |
| `npm run dev:local`  | App against local emulators                                |
| `npm run dev`        | App against your real Firebase project (uses `.env.local`) |
| `npm run emulators`  | Start local Auth + Firestore emulators                     |
| `npm test`           | Unit tests (sorting, totals, parsing, activity, receipts)  |
| `npm run test:rules` | Security-rule tests against the Firestore emulator         |
| `npm run typecheck`  | TypeScript check                                           |
| `npm run build`      | Production build into `dist/`                              |
| `npm run deploy`     | Build + deploy hosting and Firestore rules                 |
| `npm run format`     | Prettier                                                   |

## How it's built

- **Vite + React + TypeScript**, with `vite-plugin-pwa` for the service worker and manifest
- **Firebase Auth** (Google) and **Cloud Firestore** with a persistent offline cache
- **Security rules** (`firestore.rules`):
  - Only household members can read anything.
  - Joining needs the current invite code.
  - Activity entries can only be created, as yourself, with a server timestamp. They can never be edited or deleted.
- Every item change writes its activity entry **in the same atomic batch**, so the log can't miss a change even without a server.

```
src/
  lib/          pure logic + tests: aisle sorting, totals, quick-add parsing, activity feed,
                receipt checks, line matching, spending summaries
  data/         Firestore reads/writes: household, items, trips, receipts, Gemini call, live hooks
  components/   screens: sign-in, onboarding, Fridge Board, item sheet, receipts, spending,
                feed, settings
worker/         push relay (Cloudflare Worker): Web Push encryption + VAPID, no dependencies
public/push-sw.js  shows and merges notifications on the phone
tests/          security-rule and relay tests (run inside the Firestore emulator)
```

## What's next

1. Live Harris Teeter prices and aisles from the Kroger API (after the location spike)
2. Price history per item across stores, from saved receipts
