# Fridgeboard

A shared grocery list for two phones (Android + iPhone) that replaces the whiteboard on the fridge. It's a free, installable web app (PWA) with Google sign-in and live sync through Firebase.

- **Fridge Board**: items handwritten in each person's marker color
- **Store pills**: Harris Teeter · Target · Amazon sub-lists
- **Aisle order**: sorts the board in the order you walk the store
- **Price and aisle per store**, with a running estimated total
- **Grocery** and **Nice-to-have** lists
- **Activity log** of every change, with multi-item adds grouped
- **Trips**: shopping together (shared live check-off) or solo (partner sees a banner)
- Works **offline** in the store and syncs when signal comes back

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

## Scripts

| Command              | What it does                                               |
| -------------------- | ---------------------------------------------------------- |
| `npm run dev:local`  | App against local emulators                                |
| `npm run dev`        | App against your real Firebase project (uses `.env.local`) |
| `npm run emulators`  | Start local Auth + Firestore emulators                     |
| `npm test`           | Unit tests (sorting, totals, parsing, activity grouping)   |
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
  lib/          pure logic + tests: aisle sorting, totals, quick-add parsing, activity feed
  data/         Firestore reads/writes: household, items, trips, live hooks
  components/   screens: sign-in, onboarding, Fridge Board, item sheet, feed, settings
tests/          security-rule tests (run inside the Firestore emulator)
```

## What's next

1. Push notifications ("Alex is at Harris Teeter") through a free Cloudflare Worker
2. Receipts → spending with Gemini (Firebase AI Logic, free tier)
3. Live Harris Teeter prices and aisles from the Kroger API (after the location spike)
