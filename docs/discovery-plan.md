# Stocked: Discovery Plan

> **Phase:** MVP in progress · **Revised:** 2026-11-11 (v5: MVP status brought up to date through PR #20) · **Owners:** you + girlfriend (the only two users, and the product team)
> **Name:** Stocked (renamed from the working name Fridgeboard on 2026-11-01).

**What changed in v2:** switched to an installable **PWA** (no app stores). **Google sign-in** through Firebase. A **$0 stack that needs no credit card**. A new **receipts and spending** feature. Store plans tailored to how you shop. Target pricing options researched.

---

## 1. Problem statement

The grocery list lives on a whiteboard on the fridge. That works at home and stops working everywhere else:

- You can't see it at Target or Harris Teeter unless someone took a photo.
- Neither of you knows what the other added, or when.
- Nothing connects the list to stores, prices, carts, or what you actually spend.
- "Need now" and "would be nice" are mixed together, or the second kind never gets written down.

**Job to be done:** _"When either of us notices we need something, we add it in seconds. When we shop, together or alone, we see the right list for that store and check things off live. Afterward we snap the receipt and know what we spent."_

## 2. Your household profile

| Topic             | Answer                                      | What it means for the design                                                                        |
| ----------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Devices           | Android (you), iPhone (her)                 | One PWA installed on both home screens                                                              |
| Sign-in           | Google                                      | Firebase Auth, Google provider                                                                      |
| How you shop      | Usually **together**, sometimes **solo**    | Shared live trip (both phones see check-offs) plus a solo trip that notifies the other person       |
| **Target**        | **Order pickup**, Target Circle member      | Target is a _build list → place order in Target app → pick up_ flow, not an aisle walk              |
| **Harris Teeter** | **In store**, VIC card                      | Full in-store mode: sorted by aisle, check-off, VIC price estimate                                  |
| **Amazon**        | Prime                                       | Add-to-cart link handoff. Prices mainly from order history                                          |
| Location          | **28262** (Charlotte, University City area) | Default zip code for store lookup. The nearest Target and Harris Teeter are chosen once in Settings |
| Budget            | **Free**                                    | Everything in §5 runs at $0 with no billing account                                                 |

## 3. Requirements

### 3.1 Must have (MVP)

| ID  | Requirement                                                                                          | Notes                                                                      |
| --- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| R1  | **Installable PWA** for Android (Chrome) and iOS (Safari, "Add to Home Screen")                      | Opens full screen, has its own icon, works offline                         |
| R2  | **Google sign-in**, separate accounts, one shared household                                          | Invite your partner by link or 6-digit code                                |
| R3  | Real-time sync, under 1 second when both phones are online                                           | Firestore listeners, optimistic UI                                         |
| R4  | Works offline in the store and syncs when signal returns                                             | Firestore's offline cache (IndexedDB)                                      |
| R5  | **Two lists: Grocery (need) and Nice-to-have**                                                       | One tap moves an item between them                                         |
| R6  | **Activity log**: every add, edit, check-off, move, and delete records who did it and when           | Multi-item adds appear as one grouped entry that expands to show each item |
| R7  | Store tags per item: Harris Teeter, Target, Amazon                                                   | Filter the list by store                                                   |
| R8  | Quantity, unit, and optional note per item                                                           | "2 × gallon, the lactose-free one"                                         |
| R9  | **Trips**: _Shop together_ (shared live check-off) and _Shopping solo_ (partner gets a notification) | See §6                                                                     |

### 3.2 Should have (v1.x)

| ID  | Requirement                                                 | Notes                                                                                                  |
| --- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| R10 | **Receipt upload and catalog**                              | Photo or screenshot → parsed items, prices, tax, total. See §7                                         |
| R11 | **Spending dashboard**                                      | By month, store, category, and person. Price history per item                                          |
| R12 | **Price display** for each store                            | Harris Teeter: live from the Kroger API. Target and Amazon: last price you paid, from receipts. See §8 |
| R13 | Target pickup helper                                        | Opens each item in the Target app. Marks the order as placed and then picked up                        |
| R14 | Amazon cart handoff                                         | Public add-to-cart URL with your saved ASINs                                                           |
| R15 | Auto-categorize into aisles, plus staples / recurring items | Rules first, then learn from your edits                                                                |
| R16 | Push notifications                                          | Android Chrome: yes. iOS: only for the installed home-screen app on iOS 16.4+                          |

### 3.3 Chosen design requirements (v3: Fridge Board + aisles + prices)

These move into the **MVP**, because they define the main screen.

| ID  | Requirement                                                                                                                                               | Notes                                                                                                             |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| R17 | **Fridge Board main screen**: handwritten-style items in each person's marker color, store "magnets" in All view, checked items stay crossed out in place | From concept A                                                                                                    |
| R18 | **Price and aisle per item, per store**                                                                                                                   | Edit sheet opened by tapping the item. Each price shows its source: VIC (Kroger API), paid (receipt), or typed in |
| R19 | **Store sub-list pills**: All · Harris Teeter · Target · Amazon, each showing how many items are open                                                     | An item can belong to several stores. A store pill shows every item that has that store                           |
| R20 | **Aisle order pill**: re-sorts the board by walking order for the selected store, with aisle headers                                                      | Items with no aisle go in a _Not placed yet_ group at the bottom. In All view: grouped by store, then by aisle    |
| R21 | Running estimated total for the current view                                                                                                              | Counts open items only. Says how many have no price                                                               |

### 3.4 Out of scope for MVP

Payments, checkout inside the app, coupon clipping, Apple Watch / Wear OS, native widgets (PWAs can't make them).

## 4. Industry-standard roadmap (adjusted for a PWA)

| Priority | Feature                                                                          | PWA notes                                                                                                                            |
| -------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| ★★★      | **Store mode** for Harris Teeter: aisle sort, big check targets, screen stays on | Wake Lock API works on both platforms                                                                                                |
| ★★★      | **Quick add** with autocomplete from your history                                | Works fully                                                                                                                          |
| ★★★      | **Receipts → spending** (now core, see §7)                                       | Camera through file input works on both                                                                                              |
| ★★       | **Smart suggestions**: "You buy bananas about every 6 days"                      | Built from receipt history                                                                                                           |
| ★★       | **Barcode scan to add**                                                          | Use the `zxing` JS library. iOS Safari has no built-in BarcodeDetector                                                               |
| ★★       | **Voice add**                                                                    | Android: Google Assistant can open a URL. iOS: a Siri **Shortcut** that posts to the app's add endpoint ("Hey Siri, add to Stocked") |
| ★★       | **Budgets** with a monthly limit and alerts at 80%                               | From receipt totals                                                                                                                  |
| ★★       | **Recipes to list** (paste a URL, ingredients are extracted)                     | Recipe sites publish structured data (schema.org/Recipe)                                                                             |
| ★        | Meal planner                                                                     | Feeds the Grocery list                                                                                                               |
| ★        | Pantry inventory with expiry reminders                                           | High upkeep, so optional                                                                                                             |
| ✗        | Home-screen widgets, Live Activities, watch apps                                 | **Not possible as a PWA.** This is the main thing the PWA choice costs you                                                           |

## 5. Architecture: free, PWA, Firebase

### 5.1 The $0 stack (no credit card required)

| Layer                                             | Choice                                                                                                                       | Free-tier limits (more than enough for 2 people)        |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| App                                               | **Vite + React + TypeScript** with `vite-plugin-pwa` (Workbox service worker, web manifest)                                  | n/a                                                     |
| Hosting                                           | **Firebase Hosting** at `fridgeboard.web.app` (free subdomain, HTTPS)                                                        | 10 GB stored, ~360 MB/day transfer                      |
| Sign-in                                           | **Firebase Auth, Google provider**                                                                                           | Free for Google sign-in                                 |
| Database and sync                                 | **Cloud Firestore** with `persistentLocalCache` (offline support)                                                            | 1 GiB stored, 50k reads and 20k writes per day          |
| Small server (secrets, price lookups, push sends) | **Cloudflare Workers** free plan                                                                                             | 100k requests/day, cron triggers included, no card      |
| Receipt reading                                   | **Gemini through Firebase AI Logic** (Gemini Developer API free tier), with on-device **Tesseract.js** as a private fallback | Free tier has rate limits. See the privacy note in §7.4 |
| Receipt images                                    | Compressed WebP (~150–250 KB) stored **in Firestore**                                                                        | About 4,000 receipts fit in the free 1 GiB              |
| Push                                              | Firebase Cloud Messaging web push, sent from the Worker                                                                      | Free                                                    |
| Code                                              | GitHub (this repo), Prettier for formatting                                                                                  | Free                                                    |

**Why not Cloud Functions or Cloud Storage?** Both now require Firebase's pay-as-you-go **Blaze** plan, which needs a credit card. At your usage Blaze would very likely still cost $0, and you can set a $1 budget alert. If you'd rather keep it simpler, switching later is easy: the Worker code moves into Functions and images move into Storage. For now the plan stays on the free **Spark** plan, as you asked.

### 5.2 Google sign-in on an installed PWA (important detail)

Google sign-in from a home-screen app on an iPhone is the most common place PWAs break. To avoid that:

1. Host on **Firebase Hosting** and set `authDomain` to the same domain the app runs on (`fridgeboard.web.app`). The sign-in handler (`/__/auth/handler`) is then served from the app's own domain, which avoids Safari's cross-site storage blocking.
2. Use `signInWithRedirect` in standalone mode and `signInWithPopup` in a normal browser tab.
3. Sign in **inside the installed app**, not in Safari first. On iOS, a home-screen app has storage separate from Safari.
4. Security rules allow access only to the two Google accounts listed in the household (`memberIds`). No one else can read anything, even with the URL.

### 5.3 Data model

```text
households/{hid}
  name, memberIds[], inviteCode, zip: "28262"
  stores: { target: {storeId, mode:"pickup"}, harris_teeter: {krogerLocationId, mode:"in_store"},
            amazon: {mode:"delivery"} }
  budget: { monthlyCents, alertAtPct: 80 }
  zoneOrder: { harris_teeter: ["Produce", "Bakery", "Deli", ...numbered aisles..., "Frozen", "Dairy"] }  // walking order for named zones

households/{hid}/items/{itemId}
  name, normalizedName, list: "grocery" | "nice_to_have"
  qty, unit, note, category, storeTags[], preferredStore
  status: "open" | "checked" | "ordered" | "deleted"        // "ordered" = in a Target pickup order
  productRefs: { target?: tcin, kroger?: productId, amazon?: asin }
  storeInfo: {                                               // one entry per store the item can be bought at
    [store]: {
      aisle: { label: "7" | "G14" | "Produce", sortKey: 7, source: "kroger" | "learned" | "manual" },
      price: { cents, kind: "vic" | "regular" | "paid" | "manual", source, at, receiptId? }
    }
  }
  createdBy, createdAt, updatedBy, updatedAt

households/{hid}/activity/{eventId}        // append-only
  actorId, type, itemIds[], batchId?, diff?, at

households/{hid}/trips/{tripId}
  store, mode: "together" | "solo", participants[], startedAt, endedAt,
  checkedItemIds[], estTotalCents, receiptId?

households/{hid}/receipts/{receiptId}
  store, storeLocation, purchasedAt, channel: "in_store" | "pickup" | "delivery"
  subtotalCents, taxCents, savingsCents, totalCents, paidBy (uid)
  lines: [{ rawText, name, qty, unitCents, lineCents, category, itemId?, productRef? }]
  status: "parsing" | "needs_review" | "confirmed"
  imageChunks: n                            // image stored in receiptImages/{receiptId}_{i}

users/{uid}
  displayName, photoURL (from Google), color, householdId, notificationPrefs, fcmTokens[]
```

**Activity log without a server:** on the Spark plan there are no database triggers, so the app writes each activity entry in the **same batched write** as the change itself. Security rules require `actorId == request.auth.uid` and allow **create only**: no updates and no deletes. The log can't be edited or faked, even by you.

### 5.4 System sketch

```mermaid
flowchart LR
  A[Android PWA] <-->|Firestore SDK + offline cache| F[(Firestore)]
  I[iOS PWA] <-->|Firestore SDK + offline cache| F
  A & I -->|Google sign-in| AU[Firebase Auth]
  A & I -->|receipt photo| G[Gemini via Firebase AI Logic]
  G -->|structured JSON| A & I
  A & I -->|price lookup, notify partner| W[Cloudflare Worker]
  W --> K[Kroger API: Harris Teeter prices]
  W --> P[FCM web push]
  W -.cron nightly.-> K
```

## 6. Shopping flows by store

### Harris Teeter: in store, VIC

1. Tap **Start trip → Harris Teeter → Together or Solo**.
2. The list sorts by aisle and the screen stays on. The estimated total uses the Kroger API's _promo_ price where there is one (the VIC/card price, **to be confirmed in the spike**) and the regular price otherwise.
3. **Together:** both phones show the same trip. Each check-off appears on the other phone right away, with the checker's color. You can split up by aisle without texting.
4. **Solo:** your partner gets "Alex is at Harris Teeter (12 items)" and can add things while you're there. New additions flash at the top.
5. **End trip:** you're prompted to snap the receipt, and the trip closes against it.

### Target: order pickup, Target Circle

1. Filter the list to **Target**. Each item shows the last price you paid there.
2. **Build pickup order:** each item has an **Open in Target** button, which opens the product in the Target app through its product link, where Circle offers apply. Mark each item **Added** as you go.
3. **Order placed:** the items move to the _Ordered_ state, so neither of you adds them again.
4. **Picked up:** snap the receipt or a screenshot of the order in the Target app. Items are checked off and the prices you actually paid are recorded.

### Amazon: Prime

- An **Send to Amazon cart** button builds one add-to-cart link from the saved ASINs of every item tagged Amazon.
- Prices come from screenshots of your Amazon orders, parsed the same way as receipts.

## 7. Receipts and spending (new)

### 7.1 Capture

- **Camera photo** of a paper receipt (Harris Teeter, Target in store).
- **Screenshot** from the Target app, Amazon orders, or emailed receipts. These are often more accurate than paper.
- Multiple photos for long receipts, stitched in order.
- Recorded as **paid by** whoever uploads it, which you can change.

### 7.2 Parse

1. The app compresses the image and sends it to Gemini with a strict output schema: store, date, items, quantities, prices, savings, tax, total.
2. **Check:** the line items must add up to the subtotal, and subtotal plus tax to the total, within a few cents. If they don't, the receipt is marked _Needs review_.
3. **Match:** each receipt line is matched to an item on your list ("HT ORG SPINACH 10Z" → _Spinach_). You confirm uncertain matches once and the app remembers them.
4. Matched items are checked off, and `lastPaid` updates with the real price.

### 7.3 Spending dashboard

- This month vs. last month, and against your budget.
- Spending by **store**, **category** (produce, dairy, household…), and **person**.
- **Price history** for each item across stores: "Oat milk: HT $3.99 with VIC, Target $4.29."
- Savings: VIC and Circle discounts recorded from the receipts.
- Export to CSV, if you ever want it in a spreadsheet.

### 7.4 Privacy note

Receipts include the store location, the last 4 digits of your card, and sometimes a member ID. Two protections:

- The app **crops off** the payment section before upload. You draw a box or tap "hide card info".
- Google's terms allow it to use data sent to the **free** Gemini tier to improve its products. If that bothers you, switch to **on-device Tesseract.js**: fully private, but less accurate, so expect to fix more lines by hand.

## 8. Store prices: what's actually possible

| Store             | How you shop   | Price source                                                                                                                                                 | Outlook                                                                                                                                                                                                              |
| ----------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Harris Teeter** | In store, VIC  | **Kroger Developer API** (free account). Harris Teeter is a Kroger company. Products API with a `locationId` returns regular and promo prices for that store | 🟡 Probable. **Spike 1:** confirm a Harris Teeter near 28262 shows up in the Kroger Locations API                                                                                                                    |
| **Target**        | Pickup, Circle | **Your own receipts and order screenshots** (free, exact, include Circle discounts)                                                                          | 🟢 Reliable for "last paid"                                                                                                                                                                                          |
|                   |                | Target's **internal website API** (what target.com itself calls, sometimes called "Redsky") can return store-specific prices                                 | 🔴 Unofficial: undocumented, against Target's terms, and can be blocked or change at any time. I tried to test it from this session and the request was blocked. **Not recommended as something the app depends on** |
|                   |                | Paid data providers (e.g. RedCircle API)                                                                                                                     | 🔴 Not free past a trial                                                                                                                                                                                             |
| **Amazon**        | Prime          | Order screenshots → receipts. The official product API needs an Associates account with recent sales                                                         | 🟡 Receipt-based                                                                                                                                                                                                     |

**Bottom line on Target:** there's no free, official way to get live Target prices. The best free option is "last paid" from your own pickup orders. You already get an itemized order in the Target app, and a screenshot of it gives exact prices including Circle discounts. After a month of orders, most of your regular items will have a real price. The app will show `Target · paid $3.49 on Oct 24` rather than pretending to have a live price.

## 9. Design direction (decided in v3)

**Chosen: A + B + C combined, with A (Fridge Board) as the main screen.** An interactive prototype is at the top of [`design-concepts.html`](design-concepts.html).

**Main screen layout, top to bottom:**

1. **Grocery / Nice-to-have** tabs.
2. **Pill row**: an **Aisle order** toggle (sort icon), a divider, then **store pills**: All · Harris Teeter · Target · Amazon. Each store pill shows its open count, and the row scrolls sideways if more stores are added.
3. **The board**: lined whiteboard. Items are handwritten in the marker color of whoever added them, followed by a store magnet (All view only), the aisle (when not sorted), and the price.
4. **Total bar**: estimated total for the open items in view, plus how many have no price.
5. **Tap an item** to open the edit sheet: price and aisle for each store, with each price's source shown.

**How aisle sorting works**

- **Sort key:** numbered aisles sort by number. Letter-prefixed aisles (Target's `G14` style) sort by letter, then number. Named zones (Produce, Bakery, Dairy, Frozen) use the `zoneOrder` you set once per store, matching how you walk your Harris Teeter.
- **Where aisles come from:**
  1. **Kroger API** (Harris Teeter). The Products API can return aisle locations for a given store. **Confirm in Spike 1.**
  2. **Learned:** during a trip, the order you check items off is recorded. Items you always check off right after oat milk get placed next to it.
  3. **Typed in** through the edit sheet. This always wins over the other two.
- Items with no aisle go in a **Not placed yet** group at the bottom of the board, so they still get noticed.
- In **All** view with Aisle order on, the board groups by store first, then by aisle.

**Other screens**

- **Us** tab: the activity feed from D, with the Nice-to-have swipe deck.
- **Spending** tab: receipts, monthly totals, budget, and price history (§7).

**Target note:** you use pickup at Target, so Target aisles matter less. The Target sub-list is mainly for building the pickup order and seeing prices. The aisle field is still there for times you go in.

## 10. Roadmap

| Phase                        | Scope                                                                                                                                                                                         | Exit criteria                                     |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| **0. Discovery** (now)       | This plan. **Spike 1:** Kroger API + Harris Teeter near 28262. **Spike 2:** Google sign-in in an installed iOS PWA. **Spike 3:** Gemini parsing on 5 real receipts (2 HT, 2 Target, 1 Amazon) | All three spikes have an answer                   |
| **1. MVP** (~4–5 weekends)   | R1–R9 + R17–R21: PWA install, Google sign-in, household invite, Fridge Board with store pills, aisle-order sort, typed-in prices and aisles, two lists, sync, offline, activity log, trips    | The whiteboard goes unused for 2 weeks            |
| **2. Receipts and spending** | R10–R11: upload, parse, review, match, dashboard, budget                                                                                                                                      | 90% of receipt lines parse without manual fixes   |
| **3. Store smarts**          | R12–R16: Harris Teeter prices, Target pickup helper, Amazon cart link, categories, staples, push                                                                                              | Harris Teeter estimate within ~10% of the receipt |
| **4. Delight**               | Suggestions, barcode, Siri Shortcut / Assistant add, recipes                                                                                                                                  | Adding an item takes under 3 seconds              |

## 11. Risks

| Risk                                                      | Impact                               | Mitigation                                                                             |
| --------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------- |
| Google sign-in quirks in an iOS home-screen app           | Can't sign in                        | Same-domain `authDomain` + redirect sign-in (§5.2), tested first in Spike 2            |
| iOS PWA push needs iOS 16.4+ and the installed app        | No alerts on her phone               | Fallback: an in-app banner the next time the app opens                                 |
| Kroger API doesn't include Harris Teeter, or no VIC price | No live HT prices                    | Receipt-based last-paid prices, the same as Target                                     |
| Gemini free tier changes or privacy concerns              | Receipt parsing stops or feels risky | Tesseract.js fallback. Parsing sits behind one interface, so the engine can be swapped |
| Free-tier limits                                          | Writes fail                          | 20k writes/day is about 100× what two people use                                       |
| iOS deletes site data for an unused PWA                   | Local cache lost                     | Firestore is the real copy. The cache refills on next open                             |

## 12. Open questions (remaining)

1. **Logging:** built as: every change is logged, and multi-item adds are grouped into one entry. Say if you meant something different.
2. **Checked items:** built as: they stay crossed out until you tap _Clear checked_. Say if you'd rather they disappear.
3. **Monthly grocery budget** to track against, if you want one (needed for the Spending tab).
4. What's her iPhone's iOS version? It needs 16.4+ for push notifications.
5. ~~App name~~: answered, **Stocked**, with a pantry-shelves icon.

### Answered in v4

- **Walmart dropped.** Stores are Harris Teeter, Target, and Amazon.
- **Receipts use Gemini** (free tier through Firebase AI Logic), with the payment section cropped off before upload.
- **MVP built:** see §13.

### Answered in v2

- Platform: **PWA + Firebase + Google sign-in** · Shopping: **mostly together, sometimes solo** · Target: **pickup, Circle** · Harris Teeter: **in store, VIC** · Amazon: **Prime** · Zip: **28262** · Budget: **free** · New feature: **receipts and spending**

## 13. MVP status (v5, 2026-11-11)

Built in this repo and tested end to end against the local Firebase emulators:

| Req                                  | Status                                                                                                                                                                                          | Where                                                                                                      |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| R1 Installable PWA                   | ✅ Manifest, icons, service worker, offline app shell                                                                                                                                           | `vite.config.ts`, `public/`                                                                                |
| R2 Google sign-in + shared household | ✅ Create, or join with a 6-character invite code. Redirect sign-in in the installed app                                                                                                        | `src/auth.ts`, `src/data/household.ts`                                                                     |
| R3/R4 Real-time sync, offline        | ✅ Firestore listeners + persistent offline cache                                                                                                                                               | `src/firebase.ts`, `src/data/hooks.ts`                                                                     |
| R5 Grocery + Nice-to-have            | ✅ Tabs, move from the item sheet or with "→ Grocery"                                                                                                                                           | `ListScreen.tsx`, `ItemSheet.tsx`                                                                          |
| R6 Activity log                      | ✅ Written in the same batch as each change. Rules make it append-only. Multi-item adds grouped                                                                                                 | `src/data/items.ts`, `Feed.tsx`, `firestore.rules`                                                         |
| R7 Store tags                        | ✅ Harris Teeter, Target, Amazon. An item can be at several stores                                                                                                                              | `src/lib/stores.ts`                                                                                        |
| R8 Quantity, note                    | ✅ "2 milk" or "bananas x6" in the add box, a stepper in the sheet                                                                                                                              | `src/lib/text.ts`                                                                                          |
| R9 Trips                             | ✅ Together or solo. Partner sees a banner and can join                                                                                                                                         | `src/data/trips.ts`, `Shell.tsx`                                                                           |
| R17 Fridge Board                     | ✅ Handwritten items in marker colors, store magnets, crossed out when checked                                                                                                                  | `ListScreen.tsx`, `styles.css`                                                                             |
| R18 Price + aisle per store          | ✅ Edit sheet, price source shown                                                                                                                                                               | `ItemSheet.tsx`                                                                                            |
| R19 Store pills                      | ✅ With open counts                                                                                                                                                                             | `ListScreen.tsx`                                                                                           |
| R20 Aisle order pill                 | ✅ Walking order, Harris Teeter areas editable in Settings                                                                                                                                      | `src/lib/aisles.ts`, `Settings.tsx`                                                                        |
| R21 Estimated total                  | ✅ Quantity × price, counts items with no price                                                                                                                                                 | `src/lib/money.ts`                                                                                         |
| R16 Push notifications               | ✅ Web Push through the Cloudflare Worker relay (see README → Notifications)                                                                                                                    | `src/push.ts`, `Notifications.tsx`, `worker/`, `public/push-sw.js`                                         |
| R10/R11 Receipts + spending          | ✅ Photos with black-out boxes → Gemini → review (sum check, line matching, remembered matches) → prices paid + check-off. Spend tab: month vs last, budget, by store, by person, 6 months, CSV | `src/lib/receipts.ts`, `src/data/receipts.ts`, `src/data/receiptParser.ts`, `ReceiptFlow.tsx`, `Spend.tsx` |
| Quick add + list import              | ✅ Quick add tab next to Grocery (usuals), import a pasted list, remove imported items                                                                                                          | `QuickList.tsx`, `ImportItems.tsx`, `ClearImported.tsx`, `src/lib/quickList.ts`, `src/lib/importList.ts`   |
| Who paid + cards                     | ✅ Pick the card per receipt or in bulk, read it from photos, totals "By card", shopper tips                                                                                                    | `CardSelect.tsx`, `ImportReceipts.tsx`, `src/lib/cards.ts`, `src/lib/receiptImport.ts`                     |
| Settle up                            | ✅ Receipts split evenly; who owes whom, "Mark as paid back" with Undo, settlement history with Remove; card hides once you're all square                                                       | `SettleUp.tsx`, `src/lib/settle.ts`, `src/data/settle.ts`                                                  |
| Price history                        | ✅ Per-store chart of what you've paid in the item sheet, with "up/down X% since …"                                                                                                             | `PriceChart.tsx`, `ItemSheet.tsx`                                                                          |
| Recaps                               | ✅ Monthly recap (card on Spend for the first week) and weekly recap notification; recap reports with takeaways                                                                                 | `RecapCard.tsx`, `RecapReport.tsx`, `src/lib/recapReport.ts`                                               |
| Barcode scan                         | ✅ Phone's BarcodeDetector, or bundled zxing-wasm on iPhone; names from past scans or Open Food Facts                                                                                           | `BarcodeScanner.tsx`, `src/data/barcodes.ts`, `src/lib/barcode.ts`                                         |
| Recipe import                        | ✅ Paste a recipe or link, or a photo; relay `/recipe` route reads the page, Gemini makes the shopping list                                                                                     | `RecipeSheet.tsx`, `src/data/recipeParser.ts`, `worker/`                                                   |
| Notification extras                  | ✅ One-tap setup from a phone, snooze, quiet hours, devices list, new event kinds                                                                                                               | `Notifications.tsx`, `docs/NOTIFICATIONS-FROM-PHONE.md`                                                    |
| R15 Categories                       | ✅ Guessed from the name, or set in the item sheet and remembered per name. Items with no aisle sort into their category's zone (Produce, Dairy…)                                               | `src/lib/categories.ts`, `ItemSheet.tsx`, `src/lib/aisles.ts`                                              |
| R11 Spending by category             | ✅ "By category" on Spend from receipt item lines; tap a category to move items, which the app learns                                                                                           | `Spend.tsx`, `src/lib/categories.ts`                                                                       |
| Voice add                            | ✅ "Hey Siri, Stocked": a Shortcut posts to the relay's `/add` with a per-person voice key (only its hash is stored; rules check it). Android via HTTP Shortcuts                                | `VoiceAdd.tsx`, `worker/src/voice.ts`, `src/lib/voice.ts`, `firestore.rules`                               |
| R12 Live Harris Teeter prices/aisles | ⏳ Phase 3, after the Kroger spike                                                                                                                                                              | —                                                                                                          |

**Tests (2026-11-11):** 139 unit tests in 19 files, plus the emulator tests for security rules and the relay (`npm run test:rules`). Originally 67 unit tests (aisle sorting, totals, parsing, activity grouping, receipt reading, sum checks, line matching, spending summaries, CSV, Web Push encryption checked against an independent implementation, relay behavior, service worker merging) and 21 emulator tests (security rules, plus the relay reading real Firestore with the sender's token).

**App icon:** a happy fridge on a sunny tile, with a whiteboard checklist in both marker colors and a tomato magnet.

**Receipts, as built (Phase 2):** receipt photos aren't stored anywhere. Spark has no Cloud Storage, and keeping them out of Firestore keeps the free quota for the list. Price history per item has since shipped (see the table above). Spending by category has shipped too (v5). A receipt that doesn't add up can still be saved after review.
