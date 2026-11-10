# Click-through test, 2026-11-01

Run against the local emulators (`demo-fridgeboard`) at commit `34702ae`, with Playwright driving Microsoft Edge. Two users on two phones: **Alex** on an iPhone-sized screen (390 px) and **Sam** on a Pixel-sized screen (412 px). Then a 320 px phone in dark mode, and a desktop window.

**Result:** all 26 scripted steps pass. Nothing crashed, and there were no console errors apart from expected network errors while offline. No screen is wider than the phone at 320, 390 or 412 px. The issues below are things a user would trip over.

## What worked

- Sign-in, creating a household, and joining with an invite code. A wrong code shows a clear error, and a lowercase code works.
- Quick add: `eggs, 2 milk, bread x3, Eggs` gives 3 items with quantities, and the duplicate is reported. Input of only commas adds nothing. Long names and emoji display fine.
- Item sheet: prices and aisles, rejecting a bad price, Escape closes without saving, line price = quantity × price.
- Store pills, counts, estimated total per store, aisle order with zone headers.
- Check, uncheck, and Clear checked with its confirmation step.
- Nice-to-have list and moving an item to Grocery.
- Live sync between the two phones:
  - adds, in each person's marker color
  - household rename
  - receipts
- Trips:
  - a solo trip shows the partner a banner
  - when the partner joins, it becomes "Shopping together"
  - check-offs appear live on both phones
  - End trip clears the banner on both phones
- Activity feed, Settings (colors, walking order with case-insensitive duplicate check, New code), and leaving a household.
- Receipts:
  - typed in by hand
  - the mismatch warning
  - the matched item gets the price actually paid and is checked off
  - month navigation, changing who paid, and removing a receipt
- Budget meter.
- Offline: the banner appears, an item added offline shows at once, and it reaches the other phone after reconnecting.
- Reloading keeps you signed in and keeps the store filter. Opening `/#spend` lands on the Spend tab.
- Dark mode at 320 px, and the desktop layout.

## Issues

| #   | Area     | Severity | What happens                                                                                                                                                                                                                       | Evidence                                                                      |
| --- | -------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1   | Receipts | Medium   | A receipt typed in by hand starts with **Store: Other store**. If you don't change it, matched items get checked off but **no price is recorded**, and nothing tells you why.                                                      | [receipt-default-other-store.png](2026-11-01/receipt-default-other-store.png) |
| 2   | Trips    | Medium   | **Start trip** only appears once you pick a store pill. In the default **All** view there's no button and no hint, so the trip feature is easy to miss.                                                                            | [trip-together.png](2026-11-01/trip-together.png)                             |
| 3   | Receipts | Low      | On a new hand-typed receipt (total $0.00), the banner says "Doesn't add up yet. You can still save it." without saying what's wrong. It should ask for the lines and the total.                                                    | [receipt-zero-total-warning.png](2026-11-01/receipt-zero-total-warning.png)   |
| 4   | Spend    | Low      | Typing an invalid budget (`abc`) and pressing Enter or Save does nothing visible: no error, and the form stays open.                                                                                                               | [budget-invalid-silent.png](2026-11-01/budget-invalid-silent.png)             |
| 5   | List     | Low      | Starting a trip turns on **Aisle order**, and it stays on after the trip ends, including in the All view.                                                                                                                          | [aisle-order-stays-on.png](2026-11-01/aisle-order-stays-on.png)               |
| 6   | List     | Low      | While items are still loading, the board says "The board is clear. Add something below." On a slow connection that briefly looks like the list was wiped.                                                                          | [board-clear-while-loading.png](2026-11-01/board-clear-while-loading.png)     |
| 7   | Item     | Low      | After a bad price, the red "Check the Target price…" message stays up after you fix the number, until you tap Save.                                                                                                                | [item-sheet-stale-error.png](2026-11-01/item-sheet-stale-error.png)           |
| 8   | Feed     | Low      | When the partner **joins** a trip, nothing is logged. The feed goes from "Alex started a solo trip" straight to "Alex finished", with no sign Sam was there.                                                                       | [feed.png](2026-11-01/feed.png)                                               |
| 9   | A11y     | Low      | Several tap targets are under 32 px:<br>• store pills are 31 px tall<br>• walking-order ↑ ↓ ✕ buttons are 29 px<br>• the month ‹ › arrows are 27×29 px                                                                             | —                                                                             |
| 10  | 320 px   | Cosmetic | On the smallest phones, the add box placeholder cuts off ("Add items… (eggs, 2 mi"), and the store pills scroll past the screen edge. The scrolling is on purpose; it just isn't obvious that Target and Amazon are further right. | [320px-dark-list.png](2026-11-01/320px-dark-list.png)                         |

Issues 1, 3 and 4 are in the receipts feature added in `34702ae`. The rest were already there.

## Found while setting up the test

A `package.json` edit I made through PowerShell saved the file with a hidden byte-order mark at the start. That stopped Vite from starting, with "JSON_PARSE expected value at line 1". It's fixed in the working copy. `docs/discovery-plan.md` had the same mark in commit `34702ae`; that's fixed in the working copy too.

## Fixes (same day)

Issues 1–8 are fixed and checked by rerunning the click-through, which now has a check for each one. All 27 steps pass. Unit tests: 67 pass. Emulator tests: 22 pass.

1. A typed-in receipt starts at **Harris Teeter**. If you pick **Other store** with matched lines, a warning says prices won't be saved.
2. **Start trip** shows in the All view too. It first asks "Where are you shopping?", listing each store with how many items it has, then switches the list to that store.
3. The receipt banner says what's missing: the line prices, or the total.
4. An invalid budget shows "Use a dollar amount like 600…".
5. The aisle order setting from before the trip comes back when the trip ends, whether you end it or your partner does.
6. While items load, the board says "Loading the board…" instead of "The board is clear".
7. The item sheet's error clears as soon as you change any field.
8. Joining a trip is logged: "Sam joined the trip to Harris Teeter". The new `trip_join` activity type needs the updated `firestore.rules` deployed together with the app.

Still open: #9 (tap targets under 32 px) and #10 (320 px cosmetics).
