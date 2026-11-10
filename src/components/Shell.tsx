import { useCallback, useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  useActiveTrips,
  useActivity,
  useAliases,
  useCatalog,
  useItems,
  useOnline,
  useReceiptsState,
} from '../data/hooks';
import { claimRecap } from '../data/household';
import {
  monthKey,
  monthLabel,
  monthRecap,
  shiftMonth,
  shiftWeek,
  summarizeMonth,
  weekKey,
  weekLabel,
  weekRecap,
  weekStart,
} from '../lib/receipts';
import { endTrip, joinTrip } from '../data/trips';
import { storeDef } from '../lib/stores';
import { notify, refreshSubscription } from '../push';
import type { Household, StoreId, Trip } from '../types';
import { Feed } from './Feed';
import { ListScreen } from './ListScreen';
import { ReceiptFlow } from './ReceiptFlow';
import { Settings } from './Settings';
import { Spend } from './Spend';
import { Avatar } from './ui';
import { AppChrome } from './AppChrome';

type Tab = 'list' | 'spend' | 'us' | 'settings';
const TABS: { id: Tab; label: string }[] = [
  { id: 'list', label: 'List' },
  { id: 'spend', label: 'Spend' },
  { id: 'us', label: 'Us' },
  { id: 'settings', label: 'Settings' },
];

function tabFromHash(): Tab {
  const h = location.hash.replace('#', '');
  if (h.startsWith('import=')) return 'settings';
  if (h.startsWith('receipts=') || h.startsWith('recap-')) return 'spend';
  return h === 'us' || h === 'settings' || h === 'spend' ? h : 'list';
}

export function Shell({ user, household }: { user: User; household: Household }) {
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const loadedItems = useItems(household.id);
  const items = loadedItems ?? [];
  const activity = useActivity(household.id);
  const catalog = useCatalog(household.id);
  const aliases = useAliases(household.id);
  const trips = useActiveTrips(household.id);
  // After you end a trip, offer to add its receipt right away.
  const [receiptFor, setReceiptFor] = useState<StoreId | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // The center + opens the List's add sheet from any tab.
  const [addRequested, setAddRequested] = useState(false);
  const keyboardProxy = useRef<HTMLInputElement>(null);
  const onAddHandled = useCallback(() => setAddRequested(false), []);
  function requestAdd() {
    // iOS only shows the keyboard for a field focused during the tap itself.
    keyboardProxy.current?.focus();
    if (tab !== 'list') go('list');
    setAddRequested(true);
  }

  async function finishTrip(trip: Trip) {
    await endTrip(household.id, user.uid, trip);
    setReceiptFor(trip.store);
    // Items checked off at this store since the trip started.
    const checked = items.filter(
      (i) =>
        i.status === 'checked' &&
        i.list === 'grocery' &&
        i.stores.includes(trip.store) &&
        i.updatedAt >= trip.startedAt,
    ).length;
    void notify(household.id, 'trip_end', { store: trip.store, checked });
  }

  async function join(trip: Trip) {
    await joinTrip(household.id, user.uid, trip);
    void notify(household.id, 'trip_join', { store: trip.store });
  }
  const online = useOnline();
  const receipts = useReceiptsState(household.id);

  // First open in a new month: send last month's recap to everyone, once per household.
  useEffect(() => {
    if (!receipts) return;
    const last = shiftMonth(monthKey(Date.now()), -1);
    if (household.recapSentFor === last) return;
    const recap = monthRecap(receipts, last);
    if (recap.cents <= 0) return;
    void claimRecap(household.id, last)
      .then((mine) => {
        if (!mine) return;
        return notify(household.id, 'recap', {
          month: monthLabel(last).split(' ')[0],
          cents: recap.cents,
          receipts: recap.receipts,
          topStore: recap.topStore ?? undefined,
          topCents: recap.topCents,
          budgetCents: household.budgetCents ?? undefined,
        });
      })
      .catch(() => undefined);
  }, [receipts, household.id, household.recapSentFor, household.budgetCents]);

  // First open in a new week: send last week's recap to everyone, once per household.
  useEffect(() => {
    if (!receipts) return;
    const start = shiftWeek(weekStart(Date.now()), -1);
    const key = weekKey(start);
    if (household.weekRecapSentFor === key) return;
    const recap = weekRecap(receipts, start);
    if (recap.cents <= 0) return;
    // Budget so far in the month the week ended in.
    const month = monthKey(shiftWeek(start, 1) - 1);
    void claimRecap(household.id, key, 'weekRecapSentFor')
      .then((mine) => {
        if (!mine) return;
        return notify(household.id, 'week_recap', {
          week: weekLabel(start),
          cents: recap.cents,
          receipts: recap.receipts,
          topStore: recap.topStore ?? undefined,
          topCents: recap.topCents,
          prevCents: recap.prevCents,
          month: monthLabel(month).split(' ')[0],
          monthCents: summarizeMonth(receipts, month).cents,
          budgetCents: household.budgetCents ?? undefined,
        });
      })
      .catch(() => undefined);
  }, [receipts, household.id, household.weekRecapSentFor, household.budgetCents]);

  useEffect(() => {
    void refreshSubscription(household.id, user.uid).catch(() => undefined);
    // The service worker renews a subscription the browser rotated; save the new one.
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === 'push-resubscribed')
        void refreshSubscription(household.id, user.uid).catch(() => undefined);
    };
    navigator.serviceWorker?.addEventListener('message', onMessage);
    return () => navigator.serviceWorker?.removeEventListener('message', onMessage);
  }, [household.id, user.uid]);

  // iOS can leave the page shifted up after the keyboard closes. Put it back.
  useEffect(() => {
    const onBlur = (e: FocusEvent) => {
      if (!(e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement)) return;
      window.setTimeout(() => {
        const active = document.activeElement;
        if (!(active instanceof HTMLInputElement || active instanceof HTMLSelectElement))
          window.scrollTo(0, 0);
      }, 100);
    };
    document.addEventListener('focusout', onBlur);
    return () => document.removeEventListener('focusout', onBlur);
  }, []);

  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  function go(t: Tab) {
    setTab(t);
    history.replaceState(null, '', t === 'list' ? location.pathname : `#${t}`);
  }

  return (
    <div className="shell">
      <AppChrome />
      {!online && (
        <div className="offline">
          Offline. Changes are saved and will sync when you’re back online.
        </div>
      )}
      {trips.map((trip) => {
        const mine = trip.participants.includes(user.uid);
        const starter = household.members[trip.startedBy];
        const store = storeDef(trip.store).name;
        return (
          <div className="trip-banner" key={trip.id}>
            <Avatar member={starter} size={20} />
            <span>
              {mine
                ? trip.mode === 'together'
                  ? `Shopping together at ${store}`
                  : `You’re shopping at ${store}`
                : `${starter?.name ?? 'Someone'} is shopping ${trip.mode === 'solo' ? 'solo ' : ''}at ${store}`}
            </span>
            {mine ? (
              <button className="btn small" onClick={() => finishTrip(trip)}>
                End trip
              </button>
            ) : (
              <button className="btn small" onClick={() => join(trip)}>
                Join
              </button>
            )}
          </div>
        );
      })}
      {/* Keyed by tab so each tab starts at the top instead of inheriting another tab's scroll. */}
      <div className={`screen${tab === 'list' ? ' screen-fixed' : ''}`} key={tab}>
        {tab === 'list' && (
          <ListScreen
            user={user}
            household={household}
            items={items}
            loading={loadedItems === null}
            trips={trips}
            catalog={catalog}
            activity={activity}
            addRequested={addRequested}
            onAddHandled={onAddHandled}
          />
        )}
        {tab === 'spend' && <Spend household={household} uid={user.uid} items={items} />}
        {tab === 'us' && <Feed household={household} events={activity} />}
        {tab === 'settings' && <Settings user={user} household={household} items={items} />}
      </div>
      {receiptFor && (
        <ReceiptFlow
          household={household}
          uid={user.uid}
          items={items}
          aliases={aliases}
          initialStore={receiptFor}
          intro={`Trip to ${storeDef(receiptFor).name} finished. Add the receipt now to record what you paid, or close this to skip.`}
          onClose={() => setReceiptFor(null)}
          onSaved={(message) => {
            setToast(message);
            window.setTimeout(() => setToast(null), 4000);
          }}
        />
      )}
      {toast && (
        <div className="toast shell-toast" role="status">
          {toast}
        </div>
      )}
      <input ref={keyboardProxy} className="keyboard-proxy" aria-hidden="true" tabIndex={-1} />
      <nav className="tabbar" aria-label="Main">
        {TABS.slice(0, 2).map((t) => (
          <TabButton key={t.id} t={t} current={tab === t.id} onClick={() => go(t.id)} />
        ))}
        <span className="tab-plus">
          <button aria-label="Add items" onClick={requestAdd}>
            <svg
              width="26"
              height="26"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.6"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </span>
        {TABS.slice(2).map((t) => (
          <TabButton key={t.id} t={t} current={tab === t.id} onClick={() => go(t.id)} />
        ))}
      </nav>
    </div>
  );
}

function TabButton({
  t,
  current,
  onClick,
}: {
  t: { id: Tab; label: string };
  current: boolean;
  onClick: () => void;
}) {
  return (
    <button aria-current={current ? 'page' : undefined} onClick={onClick}>
      <TabIcon id={t.id} />
      {t.label}
    </button>
  );
}

function TabIcon({ id }: { id: Tab }) {
  const common = {
    width: 22,
    height: 22,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  if (id === 'list')
    return (
      <svg {...common}>
        <rect x="4" y="3" width="16" height="18" rx="2.5" />
        <path d="M8 8h8M8 12h8M8 16h5" />
      </svg>
    );
  if (id === 'spend')
    return (
      <svg {...common}>
        <path d="M6 3h12v18l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4L6 21z" />
        <path d="M9 8h6M9 12h6M9 16h3" />
      </svg>
    );
  if (id === 'us')
    return (
      <svg {...common}>
        <circle cx="9" cy="9" r="3.2" />
        <circle cx="16.5" cy="10" r="2.6" />
        <path d="M3.5 19c.8-3 3-4.5 5.5-4.5s4.7 1.5 5.5 4.5M14.5 15.2c2.6-.4 4.9 1 5.8 3.8" />
      </svg>
    );
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7" />
    </svg>
  );
}
