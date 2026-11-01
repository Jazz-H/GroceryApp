import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { finishRedirectSignIn } from './auth';
import { isConfigured } from './firebase';
import { useAuthUser, useHousehold, useHouseholdId } from './data/hooks';
import { Onboarding } from './components/Onboarding';
import { SetupNeeded } from './components/SetupNeeded';
import { Shell } from './components/Shell';
import { SignIn } from './components/SignIn';

export function App() {
  if (!isConfigured) return <SetupNeeded />;
  return <Authed />;
}

function Authed() {
  const user = useAuthUser();
  const [redirectError, setRedirectError] = useState<string | null>(null);

  useEffect(() => {
    finishRedirectSignIn().catch((e: Error & { code?: string }) =>
      setRedirectError(
        e.code === 'auth/missing-initial-state' || /initial state/i.test(e.message)
          ? 'the sign-in window lost track of the app. Close Fridgeboard completely, reopen it, and try again.'
          : e.message,
      ),
    );
  }, []);

  if (user.status === 'loading') return <Splash />;
  if (user.status === 'error') return <SignIn error={user.error.message} />;
  if (!user.value) return <SignIn error={redirectError} />;
  return <WithHousehold user={user.value} />;
}

function WithHousehold({ user }: { user: User }) {
  const hid = useHouseholdId(user.uid);
  if (hid.status === 'loading') return <Splash />;
  if (hid.status === 'error') return <Splash message={hid.error.message} />;
  if (!hid.value) return <Onboarding user={user} />;
  return <LoadedHousehold user={user} hid={hid.value} />;
}

function LoadedHousehold({ user, hid }: { user: User; hid: string }) {
  const household = useHousehold(hid);
  if (household.status === 'loading') return <Splash />;
  if (household.status === 'error')
    return (
      <Onboarding
        user={user}
        notice={`We couldn’t open your household (${household.error.message}). Join or create one.`}
      />
    );
  return <Shell user={user} household={household.value} />;
}

function Splash({ message }: { message?: string }) {
  return (
    <main className="splash">
      <h1 className="wordmark">Fridgeboard</h1>
      <p className="muted">{message ?? 'Loading…'}</p>
    </main>
  );
}
