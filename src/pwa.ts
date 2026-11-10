import { registerSW } from 'virtual:pwa-register';

/**
 * Service worker updates. A new deploy downloads in the background; the app then shows an
 * "Update" banner instead of reloading under you mid-edit. Checks happen on launch, when the
 * app comes back to the foreground, every hour, and on pull-to-refresh.
 */
type Listener = (ready: boolean) => void;

let updateReady = false;
let registration: ServiceWorkerRegistration | undefined;
const listeners = new Set<Listener>();

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    updateReady = true;
    listeners.forEach((l) => l(true));
  },
  onRegisteredSW(_url, reg) {
    registration = reg;
    if (!reg) return;
    setInterval(() => void reg.update().catch(() => undefined), 60 * 60 * 1000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void reg.update().catch(() => undefined);
    });
  },
});

export function onUpdateReady(listener: Listener): () => void {
  listeners.add(listener);
  listener(updateReady);
  return () => listeners.delete(listener);
}

/** Switches to the downloaded version and reloads. */
export function applyUpdate(): void {
  void updateSW(true);
}

export type CheckResult = 'updating' | 'latest' | 'unavailable';

/** Looks for a new deploy now. If one is found, the app reloads into it. */
export async function checkForUpdate(): Promise<CheckResult> {
  if (!registration) return 'unavailable';
  try {
    await registration.update();
  } catch {
    return 'unavailable';
  }
  // Give a freshly found worker a moment to install.
  for (let i = 0; i < 20 && registration.installing; i++) {
    await new Promise((r) => setTimeout(r, 250));
  }
  if (updateReady || registration.waiting) {
    applyUpdate();
    return 'updating';
  }
  return 'latest';
}

/** Pull-to-refresh: take a waiting update if there is one, otherwise just reload. */
export async function refreshApp(): Promise<void> {
  const result = await Promise.race([
    checkForUpdate(),
    new Promise<CheckResult>((r) => setTimeout(() => r('unavailable'), 3000)),
  ]);
  if (result !== 'updating') location.reload();
}
