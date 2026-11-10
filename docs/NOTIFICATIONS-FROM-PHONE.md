# Set up notifications from a phone

About 5 minutes, all in a phone browser. Your computer isn't needed: GitHub makes the keys and
puts the relay online.

## 1. Cloudflare account and subdomain

1. Open <https://dash.cloudflare.com/sign-up>, sign up (free), and verify your email.
2. In the Cloudflare dashboard, open **Workers & Pages**. If it asks you to choose a
   **workers.dev subdomain**, pick any name (for example your first name) and save.

## 2. Cloudflare API token

1. Tap the person icon → **My Profile** → **API Tokens** → **Create Token**.
2. Next to **Edit Cloudflare Workers**, tap **Use template**.
3. Under **Account Resources** choose your account; under **Zone Resources** choose **All zones**.
4. **Continue to summary** → **Create Token**. Copy the token (it's shown once).

## 3. Give the token to GitHub

1. Open <https://github.com/Jazz-H/GroceryApp/settings/secrets/actions/new>. If GitHub shows the
   mobile site without settings, tap **Desktop site** in the browser menu.
2. Name: `CLOUDFLARE_API_TOKEN`. Secret: paste the token. **Add secret**.

## 4. Run the setup

Either ask Claude to run it, or open
<https://github.com/Jazz-H/GroceryApp/actions/workflows/setup-push.yml> → **Run workflow**,
type `NEW KEYS`, and run it. When it's green, its summary shows the relay URL and public key.
Both are public; they go in `push-config.json` (Claude can commit them), and the next deploy
builds them into the app.

## 5. On each phone

Update the app, then Settings → Notifications → **Turn on notifications** → **Send me a test**.
On iPhone this needs iOS 16.4+ and the app opened from its Home Screen icon.
