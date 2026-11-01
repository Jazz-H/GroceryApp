# Go live: get Fridgeboard on both phones

About 20 minutes. Everything is free and needs no credit card.
You need: a computer with this repo open in VS Code, Node 20+, and your Google account.

---

## Step 1: Create the Firebase project (5 min)

1. Go to <https://console.firebase.google.com> and sign in with your Google account.
2. Click **Create a project**. Name it something like `fridgeboard`.
   - Turn **Google Analytics off**, since it isn't needed.
   - Click **Create project** and wait for it to finish.
3. **Write down the Project ID.** It appears under the project name, and Firebase may add a suffix, like `fridgeboard-4f2a1`. Your app's address will be `https://<project-id>.web.app`.

## Step 2: Turn on sign-in and the database (5 min)

1. **Google sign-in:**
   - Left menu → **Build → Authentication** → **Get started**.
   - **Sign-in method** tab → **Google** → turn on **Enable**.
   - Pick your email as the support email → **Save**.
2. **Database:**
   - Left menu → **Build → Firestore Database** → **Create database**.
   - Location: **`nam5 (United States)`** or **`us-east1`**.
   - Choose **Start in production mode** → **Create**. The app's own security rules replace the defaults when you deploy.
3. **Register the web app:**
   - Click the **gear** (top left) → **Project settings** → scroll to **Your apps** → click the **`</>`** (Web) icon.
   - Nickname: `Fridgeboard`. Leave "Firebase Hosting" unchecked → **Register app**.
   - Keep the `firebaseConfig` values on screen. You need them in Step 3.
4. **Allow sign-in on your app's own address.** This is what makes iPhone sign-in work:
   - Open <https://console.cloud.google.com/apis/credentials> and make sure your Firebase project is selected at the top.
   - Under **OAuth 2.0 Client IDs**, open **Web client (auto created by Google Service)**.
   - Under **Authorized redirect URIs**, click **Add URI** and enter `https://<project-id>.web.app/__/auth/handler`.
   - Click **Save**. It can take a few minutes to take effect.

## Step 3: Deploy from VS Code (5 min)

Open the terminal in VS Code (**Ctrl+`**, or **Cmd+`** on Mac) and run:

```bash
git checkout ccr-a2983a19-k60rnw
git pull
npm install
cp .env.example .env.local
```

Open **`.env.local`** and fill it in from the `firebaseConfig` on screen:

```bash
VITE_FIREBASE_API_KEY=        # apiKey
VITE_FIREBASE_AUTH_DOMAIN=<project-id>.web.app   # NOT the firebaseapp.com value
VITE_FIREBASE_PROJECT_ID=     # projectId
VITE_FIREBASE_APP_ID=         # appId
VITE_FIREBASE_MESSAGING_SENDER_ID=   # messagingSenderId
VITE_USE_EMULATORS=false
```

Then:

```bash
npx firebase login            # opens a browser; sign in with the same Google account
npx firebase use --add        # pick your project, type "default" when asked for an alias
npm run deploy                # builds the app and publishes it + the security rules
```

When it finishes it prints **`Hosting URL: https://<project-id>.web.app`**. **That's the link for Madison.**

## Step 4: Your phone (Android)

1. Open **Chrome** and go to `https://<project-id>.web.app`.
2. Tap **⋮** (top right) → **Install app**. It may say **Add to Home screen**.
3. Open **Fridgeboard** from your home screen.
4. Tap **Sign in with Google** → **Create household**. Keep zip code `28262`.
5. Go to **Settings** → under **Invite**, tap **Share invite** to text Madison the link and code.

## Step 5: Madison's phone (iPhone)

Send Madison this message:

> Here's our grocery list app 🛒
>
> 1. Open this link in **Safari** (it has to be Safari): https://&lt;project-id&gt;.web.app
> 2. Tap the **Share** button (square with an arrow) → scroll down → **Add to Home Screen** → **Add**
> 3. Open **Fridgeboard** from your home screen (not from Safari)
> 4. Tap **Sign in with Google**, then **Join with a code**, and enter: **ABC234** ← (your code from Settings)

You'll see Madison appear in **Settings → Invite** with a second marker color. Add an item on one phone and watch it appear on the other.

## Step 6 (optional): Notifications

Follow **Notifications** in the [README](../README.md). It takes about 10 more minutes with a free Cloudflare account. Then on each phone: **Settings → Notifications → Turn on notifications → Send me a test**.
Madison's iPhone needs **iOS 16.4 or later**, and notifications only work from the home-screen app.

---

## If something goes wrong

| Problem                                            | Fix                                                                                                               |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| The app says "Connect Firebase to finish setup"    | `.env.local` is missing or empty. Fill it in, then `npm run deploy` again                                         |
| Google sign-in shows **redirect_uri_mismatch**     | Step 2.4 is missing, or still taking effect. Check the URI matches exactly, wait 5 minutes                        |
| Sign-in loops back to the sign-in screen on iPhone | Check `VITE_FIREBASE_AUTH_DOMAIN` is `<project-id>.web.app`, redeploy, then delete and re-add the home-screen app |
| `npm run deploy` says Firestore isn't set up       | Finish Step 2.2 (create the database) first                                                                       |
| "That code didn't match a household"               | Codes are 6 characters. Tap **New code** in Settings and send that one                                            |
| The app looks out of date after a deploy           | Close it fully and reopen. It updates itself on the next launch                                                   |

To push a change later: edit, then run `npm run deploy`. Both phones pick it up the next time they open the app.
