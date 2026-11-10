import { useEffect, useState } from 'react';
import {
  currentSubId,
  disablePush,
  enablePush,
  loadPhone,
  notify,
  pushSupport,
  removeDevice,
  setMutedUntil,
  setPref,
  setQuietHours,
  usePushDevices,
  type PhoneSettings,
  type PushKind,
} from '../push';
import type { Household } from '../types';

const LABELS: Record<PushKind, string> = {
  adds: 'My partner adds groceries',
  trip: 'Trips: started, joined, finished',
  receipts: 'A receipt is saved',
  budget: 'Spending passes 80% or 100% of the budget',
  recap: 'Monthly recap on the 1st',
};

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hourLabel = (h: number) =>
  new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric' });

/** 8am tomorrow, for "Snooze until morning". */
function nextMorning(now = new Date()): number {
  const d = new Date(now);
  d.setDate(d.getDate() + (d.getHours() < 8 ? 0 : 1));
  d.setHours(8, 0, 0, 0);
  return d.getTime();
}

export function Notifications({ household, uid }: { household: Household; uid: string }) {
  const [support, setSupport] = useState(pushSupport);
  const [phone, setPhone] = useState<PhoneSettings | null>(null);
  const [thisId, setThisId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const devices = usePushDevices(household.id);

  async function reload() {
    setPhone(await loadPhone(household.id));
    setThisId(await currentSubId());
  }

  useEffect(() => {
    let alive = true;
    Promise.all([loadPhone(household.id), currentSubId()])
      .then(([p, id]) => {
        if (!alive) return;
        setPhone(p);
        setThisId(id);
      })
      .catch(() => undefined)
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [household.id]);

  async function turnOn() {
    setBusy(true);
    setMessage(null);
    try {
      await enablePush(household.id, uid);
      await reload();
    } catch (e) {
      setMessage((e as Error).message);
      setSupport(pushSupport());
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    await disablePush(household.id).catch(() => undefined);
    setPhone(null);
    setThisId(null);
    setBusy(false);
  }

  async function toggle(kind: PushKind, on: boolean) {
    setPhone((p) => (p ? { ...p, prefs: { ...p.prefs, [kind]: on } } : p));
    await setPref(household.id, kind, on);
  }

  async function snooze(until: number) {
    setPhone((p) => (p ? { ...p, mutedUntil: until } : p));
    await setMutedUntil(household.id, until);
  }

  async function quiet(hours: { start: number; end: number } | null) {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    setPhone((p) => (p ? { ...p, quiet: hours ? { ...hours, tz } : null } : p));
    await setQuietHours(household.id, hours);
  }

  async function test() {
    setMessage('Sending…');
    const res = await notify(household.id, 'test');
    setMessage(
      res.ok
        ? res.sent > 0
          ? 'Sent. It should appear in a few seconds.'
          : 'The relay found no notifications turned on for this phone. Turn them off and on again.'
        : `The test didn’t go through: ${res.error}`,
    );
  }

  const snoozed = phone && phone.mutedUntil > Date.now();
  const names = (id: string) => household.members[id]?.name ?? 'Former member';

  return (
    <div className="card">
      <h2>Notifications</h2>
      {support === 'not-configured' && (
        <p className="muted">
          Notifications need a free relay set up once. It takes about 5 minutes and works from a
          phone: follow docs/NOTIFICATIONS-FROM-PHONE.md in the GroceryApp repo, or ask Claude to
          walk you through it.
        </p>
      )}
      {support === 'needs-install' && (
        <p className="muted">
          On iPhone and iPad, notifications only work from the installed app. Tap Share → Add to
          Home Screen, open Stocked from the new icon, then turn this on.
        </p>
      )}
      {support === 'unsupported' && (
        <p className="muted">This browser can’t receive notifications.</p>
      )}
      {support === 'denied' && (
        <p className="muted">
          Notifications are blocked for Stocked. Allow them in your phone’s settings for this app,
          then come back here.
        </p>
      )}
      {support === 'ready' && !loading && !phone && (
        <>
          <p className="muted">
            Get a heads-up when your partner heads to the store, adds something, or saves a receipt.
          </p>
          <div className="row-actions">
            <button className="btn primary" onClick={turnOn} disabled={busy}>
              {busy ? 'Turning on…' : 'Turn on notifications'}
            </button>
          </div>
        </>
      )}
      {support === 'ready' && phone && (
        <>
          <p className="muted">Tell me when:</p>
          <div className="toggles">
            {(Object.keys(LABELS) as PushKind[]).map((kind) => (
              <label key={kind} className="toggle" htmlFor={`pref-${kind}`}>
                <span>{LABELS[kind]}</span>
                <input
                  id={`pref-${kind}`}
                  type="checkbox"
                  role="switch"
                  checked={phone.prefs[kind]}
                  onChange={(e) => toggle(kind, e.target.checked)}
                />
              </label>
            ))}
          </div>

          <h3 className="sub-head">Snooze</h3>
          {snoozed ? (
            <div className="row-actions">
              <span className="muted">
                Snoozed until{' '}
                {new Date(phone.mutedUntil).toLocaleString(undefined, {
                  weekday: 'short',
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </span>
              <button className="btn small ghost" onClick={() => snooze(0)}>
                Unsnooze
              </button>
            </div>
          ) : (
            <div className="row-actions">
              <button className="btn small ghost" onClick={() => snooze(Date.now() + 3_600_000)}>
                1 hour
              </button>
              <button className="btn small ghost" onClick={() => snooze(nextMorning())}>
                Until 8 AM
              </button>
            </div>
          )}

          <h3 className="sub-head">Quiet hours</h3>
          <label className="toggle" htmlFor="quiet-on">
            <span>No notifications overnight</span>
            <input
              id="quiet-on"
              type="checkbox"
              role="switch"
              checked={!!phone.quiet}
              onChange={(e) => quiet(e.target.checked ? { start: 22, end: 7 } : null)}
            />
          </label>
          {phone.quiet && (
            <div className="quiet-hours">
              <label htmlFor="quiet-start">
                From
                <select
                  id="quiet-start"
                  value={phone.quiet.start}
                  onChange={(e) => quiet({ start: Number(e.target.value), end: phone.quiet!.end })}
                >
                  {HOURS.map((h) => (
                    <option key={h} value={h}>
                      {hourLabel(h)}
                    </option>
                  ))}
                </select>
              </label>
              <label htmlFor="quiet-end">
                to
                <select
                  id="quiet-end"
                  value={phone.quiet.end}
                  onChange={(e) =>
                    quiet({ start: phone.quiet!.start, end: Number(e.target.value) })
                  }
                >
                  {HOURS.map((h) => (
                    <option key={h} value={h}>
                      {hourLabel(h)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          <div className="row-actions">
            <button className="btn ghost" onClick={test}>
              Send me a test
            </button>
            <button className="btn link danger-text" onClick={turnOff} disabled={busy}>
              Turn off on this phone
            </button>
          </div>
        </>
      )}
      {message && (
        <p className="hint" role="status">
          {message}
        </p>
      )}

      {devices.length > 0 && (
        <>
          <h3 className="sub-head">Phones getting notifications</h3>
          <ul className="devices">
            {devices.map((d) => (
              <li key={d.id}>
                <span>
                  <b>{names(d.uid)}</b> · {d.device}
                  {d.id === thisId && <span className="pill-tag">This phone</span>}
                  {d.updatedAt > 0 && (
                    <span className="muted">
                      {' '}
                      · seen{' '}
                      {new Date(d.updatedAt).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </span>
                  )}
                </span>
                <button
                  className="btn small link danger-text"
                  aria-label={`Remove ${names(d.uid)}’s ${d.device}`}
                  onClick={() => (d.id === thisId ? turnOff() : removeDevice(household.id, d.id))}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
