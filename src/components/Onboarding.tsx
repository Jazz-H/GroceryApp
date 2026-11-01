import { useState, type FormEvent } from 'react';
import type { User } from 'firebase/auth';
import { signOut } from '../auth';
import { createHousehold, InviteError, joinHousehold } from '../data/household';

export function Onboarding({ user, notice }: { user: User; notice?: string }) {
  const [mode, setMode] = useState<'join' | 'create'>('create');
  const [name, setName] = useState('Our place');
  const [zip, setZip] = useState('28262');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'create') await createHousehold(user, name, zip);
      else await joinHousehold(user, code);
    } catch (err) {
      setError(
        err instanceof InviteError
          ? err.message
          : `Something went wrong: ${(err as Error).message}`,
      );
      setBusy(false);
    }
  }

  const first = (user.displayName ?? '').split(' ')[0] || 'there';
  return (
    <main className="center-page">
      <h1 className="wordmark">Hi {first}</h1>
      {notice && <p className="error">{notice}</p>}
      <p className="muted">
        One of you creates the household. The other joins with its invite code.
      </p>
      <div className="segmented" role="tablist">
        <button role="tab" aria-selected={mode === 'create'} onClick={() => setMode('create')}>
          Create household
        </button>
        <button role="tab" aria-selected={mode === 'join'} onClick={() => setMode('join')}>
          Join with a code
        </button>
      </div>
      <form className="card form" onSubmit={submit}>
        {mode === 'create' ? (
          <>
            <label htmlFor="hh-name">
              Household name
              <input
                id="hh-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={60}
                required
              />
            </label>
            <label htmlFor="hh-zip">
              Zip code (for finding your stores later)
              <input
                id="hh-zip"
                value={zip}
                onChange={(e) => setZip(e.target.value)}
                inputMode="numeric"
                maxLength={5}
              />
            </label>
            <button className="btn primary" disabled={busy}>
              {busy ? 'Creating…' : 'Create household'}
            </button>
          </>
        ) : (
          <>
            <label htmlFor="hh-code">
              Invite code
              <input
                id="hh-code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="ABC234"
                autoCapitalize="characters"
                autoComplete="off"
                maxLength={7}
                className="code-input"
                required
              />
            </label>
            <p className="hint">Find it in the other person’s app under Settings → Invite.</p>
            <button className="btn primary" disabled={busy}>
              {busy ? 'Joining…' : 'Join household'}
            </button>
          </>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </form>
      <button className="btn link" onClick={() => signOut()}>
        Not {user.email}? Sign out
      </button>
    </main>
  );
}
