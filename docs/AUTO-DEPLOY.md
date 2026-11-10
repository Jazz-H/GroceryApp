# Automatic deploys

After a one-time setup (about 10 minutes), you never run `npm run deploy` again.

- **Every pull request and branch push** runs the checks: lint, typecheck, unit tests, security-rule tests and a build. These are in `.github/workflows/checks.yml`.
- **Every push to `main`**, such as a merged pull request, runs the same checks. If they pass, it deploys the app and the Firestore rules to **https://fridgeboard-642b9.web.app**. This is in `.github/workflows/deploy.yml`.
- **Phones** show "A new version of Stocked is ready → Update", or you can pull down to refresh.

So the loop is: ask Claude for a change. Claude pushes a branch and opens a pull request. You tap **Merge** in the GitHub app, or tell Claude to merge it. The change goes live a few minutes later.

## One-time setup: let GitHub deploy to Firebase

GitHub needs a key for a Google "service account", a robot account that's only allowed to deploy this project.

1. Open **https://console.cloud.google.com/iam-admin/serviceaccounts?project=fridgeboard-642b9**. Check that the project at the top is **fridgeboard**.
2. Click **+ Create service account**.
   - Name: `github-deploy`, then click **Create and continue**.
   - Add these roles (**+ Add another role** for each):
     - **Firebase Admin**
     - **API Keys Viewer**
     - **Service Usage Consumer**
   - Click **Done**.
3. Click the new `github-deploy@…` account, then **Keys → Add key → Create new key → JSON → Create**. A `.json` file downloads. Treat it like a password.
4. Open **https://github.com/Jazz-H/GroceryApp/settings/secrets/actions** and click **New repository secret**.
   - Name: `FIREBASE_SERVICE_ACCOUNT_FRIDGEBOARD_642B9`
   - Secret: open the downloaded `.json` file in Notepad, copy **all** of it, and paste it here.
   - Click **Add secret**, then **delete the downloaded file** from your computer.
5. Optional, for notifications (or use the phone-friendly [one-tap setup](NOTIFICATIONS-FROM-PHONE.md)): under **Settings → Secrets and variables → Actions → Variables**, add `VITE_VAPID_PUBLIC_KEY` and `VITE_PUSH_URL`, the same values as in your `.env.local`. To also redeploy the relay on every merge, add a repository **secret** `CLOUDFLARE_API_TOKEN` (Cloudflare → My Profile → API Tokens → "Edit Cloudflare Workers"). The relay then gets `VITE_VAPID_PUBLIC_KEY` passed in, plus `VAPID_SUBJECT` if you add that variable too.

### Try it

Open **https://github.com/Jazz-H/GroceryApp/actions**, choose **Deploy → Run workflow → main**. A green check means the site is live. Then on your phone, pull down on the list or tap **Update**.

## If a deploy fails

Open the failed run in the **Actions** tab. The red step tells you what happened:

| Step                          | Usual cause                           | Fix                                                                                                   |
| ----------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Lint, typecheck and test      | A change broke a check                | Ask Claude to fix the failing check. Nothing was deployed.                                            |
| Firebase config for the build | The site's config couldn't be read    | Add `VITE_FIREBASE_API_KEY` and `VITE_FIREBASE_APP_ID` as repository **Variables**, from `.env.local` |
| Deploy to Firebase            | Missing secret, or a permission error | Re-check setup step 4. A "permission denied" message names the role to add to `github-deploy`         |

## Notification relay (optional)

If `worker/` changes and a `CLOUDFLARE_API_TOKEN` repository secret exists, the relay redeploys too. Create the token at Cloudflare → My Profile → API Tokens → **Edit Cloudflare Workers** template.
