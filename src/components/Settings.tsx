import { useState } from 'react';
import type { User } from 'firebase/auth';
import { isStandalone, signOut } from '../auth';
import {
  leaveHousehold,
  renameHousehold,
  rotateInviteCode,
  updateMember,
  updateZoneOrder,
} from '../data/household';
import { usingEmulators } from '../firebase';
import { AISLES_TOKEN, DEFAULT_ZONE_ORDER, MEMBER_COLORS } from '../lib/stores';
import type { Household } from '../types';
import { Avatar } from './ui';

export function Settings({ user, household }: { user: User; household: Household }) {
  const me = household.members[user.uid];
  return (
    <section className="settings">
      <h1 className="screen-title">Settings</h1>
      <Invite household={household} uid={user.uid} />
      <Household_ household={household} />
      <You household={household} uid={user.uid} />
      <ZoneOrder household={household} />
      <div className="card">
        <h2>Account</h2>
        <p className="muted">
          Signed in as {user.email}
          {me ? ` (${me.name})` : ''}.
        </p>
        {!isStandalone() && (
          <p className="hint">
            Install the app: on iPhone, tap Share → Add to Home Screen. On Android, open Chrome’s
            menu → Install app.
          </p>
        )}
        <div className="row-actions">
          <button className="btn ghost" onClick={() => signOut()}>
            Sign out
          </button>
          <LeaveButton household={household} uid={user.uid} />
        </div>
        <p className="hint">
          Fridgeboard {__APP_VERSION__}
          {usingEmulators ? ' · local emulators' : ''}
        </p>
      </div>
    </section>
  );
}

function Invite({ household, uid }: { household: Household; uid: string }) {
  const [copied, setCopied] = useState(false);
  const full = household.memberIds.length >= 6;
  async function copy() {
    try {
      await navigator.clipboard.writeText(household.inviteCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard refused: the code is selectable text */
    }
  }
  async function share() {
    const text = `Join our grocery list on Fridgeboard: open ${location.origin}, sign in, and enter code ${household.inviteCode}`;
    if (navigator.share)
      await navigator.share({ title: 'Fridgeboard invite', text }).catch(() => undefined);
    else await copy();
  }
  return (
    <div className="card">
      <h2>Invite</h2>
      <p className="muted">
        Your partner signs in with Google, chooses “Join with a code”, and enters:
      </p>
      <div className="invite-code" aria-label="Invite code">
        {household.inviteCode}
      </div>
      <div className="row-actions">
        <button className="btn primary" onClick={share} disabled={full}>
          Share invite
        </button>
        <button className="btn ghost" onClick={copy}>
          {copied ? 'Copied' : 'Copy code'}
        </button>
        <button className="btn link" onClick={() => rotateInviteCode(household, uid)}>
          New code
        </button>
      </div>
      <div className="members">
        {household.memberIds.map((id) => (
          <span key={id} className="member">
            <Avatar member={household.members[id]} /> {household.members[id]?.name ?? 'Member'}
          </span>
        ))}
      </div>
    </div>
  );
}

function Household_({ household }: { household: Household }) {
  const [name, setName] = useState(household.name);
  return (
    <div className="card">
      <h2>Household</h2>
      <label htmlFor="set-hh-name">
        Name
        <input
          id="set-hh-name"
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name !== household.name && renameHousehold(household, name)}
        />
      </label>
    </div>
  );
}

function You({ household, uid }: { household: Household; uid: string }) {
  const me = household.members[uid];
  const [name, setName] = useState(me?.name ?? '');
  return (
    <div className="card">
      <h2>You</h2>
      <label htmlFor="set-my-name">
        Display name
        <input
          id="set-my-name"
          value={name}
          maxLength={30}
          onChange={(e) => setName(e.target.value)}
          onBlur={() =>
            name.trim() && name !== me?.name && updateMember(household, uid, { name: name.trim() })
          }
        />
      </label>
      <p className="label">Your marker color</p>
      <div className="swatches" role="radiogroup" aria-label="Marker color">
        {MEMBER_COLORS.map((c) => (
          <button
            key={c}
            role="radio"
            aria-checked={me?.color === c}
            aria-label={`Color ${c}`}
            className="swatch"
            style={{ background: c }}
            onClick={() => updateMember(household, uid, { color: c })}
          />
        ))}
      </div>
    </div>
  );
}

function ZoneOrder({ household }: { household: Household }) {
  const order = household.zoneOrder.ht ?? DEFAULT_ZONE_ORDER.ht ?? [];
  const [newZone, setNewZone] = useState('');
  const save = (next: string[]) => updateZoneOrder(household, 'ht', next);
  function move(i: number, d: -1 | 1) {
    const j = i + d;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    save(next);
  }
  return (
    <div className="card">
      <h2>Harris Teeter walking order</h2>
      <p className="muted">
        Aisle order sorts named areas in this order. “{AISLES_TOKEN}” stands for all the numbered
        aisles. Match it to the way you walk your store.
      </p>
      <ol className="zones">
        {order.map((z, i) => (
          <li key={z} className={z === AISLES_TOKEN ? 'token' : ''}>
            <span>{z === AISLES_TOKEN ? 'Numbered aisles (1, 2, 3…)' : z}</span>
            <button
              className="btn small ghost"
              onClick={() => move(i, -1)}
              disabled={i === 0}
              aria-label={`Move ${z} up`}
            >
              ↑
            </button>
            <button
              className="btn small ghost"
              onClick={() => move(i, 1)}
              disabled={i === order.length - 1}
              aria-label={`Move ${z} down`}
            >
              ↓
            </button>
            {z !== AISLES_TOKEN && (
              <button
                className="btn small ghost"
                onClick={() => save(order.filter((x) => x !== z))}
                aria-label={`Remove ${z}`}
              >
                ✕
              </button>
            )}
          </li>
        ))}
      </ol>
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          const z = newZone.trim();
          if (z && !order.some((o) => o.toLowerCase() === z.toLowerCase())) save([...order, z]);
          setNewZone('');
        }}
      >
        <label htmlFor="new-zone" className="sr-only">
          New area
        </label>
        <input
          id="new-zone"
          value={newZone}
          onChange={(e) => setNewZone(e.target.value)}
          placeholder="Add an area, e.g. Pharmacy"
        />
        <button className="btn ghost">Add</button>
      </form>
    </div>
  );
}

function LeaveButton({ household, uid }: { household: Household; uid: string }) {
  const [confirm, setConfirm] = useState(false);
  if (!confirm)
    return (
      <button className="btn link danger-text" onClick={() => setConfirm(true)}>
        Leave household
      </button>
    );
  return (
    <span className="confirm-inline">
      Leave {household.name}? You’ll need a new code to rejoin.
      <button className="btn small ghost" onClick={() => setConfirm(false)}>
        Stay
      </button>
      <button className="btn small danger" onClick={() => leaveHousehold(household, uid)}>
        Leave
      </button>
    </span>
  );
}
