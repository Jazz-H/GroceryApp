import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

/** Loads public/push-sw.js into a fake service worker scope. */
function loadWorker() {
  const handlers: Record<string, (e: unknown) => void> = {};
  const shown: {
    title: string;
    options: { body: string; tag: string; data: { items: string[] } };
  }[] = [];
  const subscribed: unknown[] = [];
  const messages: unknown[] = [];
  const self = {
    addEventListener: (type: string, fn: (e: unknown) => void) => (handlers[type] = fn),
    location: { origin: 'https://fridgeboard.web.app' },
    registration: {
      getNotifications: async ({ tag }: { tag: string }) =>
        shown
          .filter((n) => n.options.tag === tag)
          .map((n) => ({ data: n.options.data, close: () => shown.splice(shown.indexOf(n), 1) })),
      showNotification: async (title: string, options: (typeof shown)[number]['options']) => {
        shown.push({ title, options });
      },
    },
    clients: {
      matchAll: async () => [{ postMessage: (m: unknown) => messages.push(m) }],
      openWindow: async () => null,
    },
  };
  Object.assign(self.registration, {
    pushManager: { subscribe: async (o: unknown) => subscribed.push(o) },
  });
  runInNewContext(readFileSync('public/push-sw.js', 'utf8'), { self, URL });

  async function push(data: object) {
    let done: Promise<unknown> = Promise.resolve();
    handlers.push({
      data: { json: () => data, text: () => JSON.stringify(data) },
      waitUntil: (p: Promise<unknown>) => (done = p),
    });
    await done;
  }
  async function resubscribe() {
    let done: Promise<unknown> = Promise.resolve();
    handlers.pushsubscriptionchange({
      oldSubscription: { options: { applicationServerKey: 'KEY' } },
      waitUntil: (p: Promise<unknown>) => (done = p),
    });
    await done;
  }
  return { push, resubscribe, shown, subscribed, messages };
}

describe('push service worker', () => {
  it('merges quick adds from the same person into one notification', async () => {
    const sw = loadWorker();
    await sw.push({
      kind: 'adds',
      actor: 'Sam',
      items: ['Eggs'],
      title: 'Sam added Eggs',
      tag: 'adds-sam',
    });
    await sw.push({
      kind: 'adds',
      actor: 'Sam',
      items: ['Milk', 'Bread'],
      count: 2,
      title: 'x',
      tag: 'adds-sam',
    });
    expect(sw.shown).toHaveLength(1);
    expect(sw.shown[0].title).toBe('Sam added 3 items');
    expect(sw.shown[0].options.body).toBe('Eggs, Milk, Bread');
  });

  it('uses the real count when a big import only lists some names', async () => {
    const sw = loadWorker();
    const names = Array.from({ length: 20 }, (_, i) => `Item ${i + 1}`);
    await sw.push({ kind: 'adds', actor: 'Sam', items: names, count: 50, tag: 'adds-sam' });
    expect(sw.shown[0].title).toBe('Sam added 50 items');
    expect(sw.shown[0].options.body.endsWith('Item 20, …')).toBe(true);
    await sw.push({ kind: 'adds', actor: 'Sam', items: ['Eggs'], count: 1, tag: 'adds-sam' });
    expect(sw.shown).toHaveLength(1);
    expect(sw.shown[0].title).toBe('Sam added 51 items');
  });

  it('subscribes again when the browser rotates the subscription', async () => {
    const sw = loadWorker();
    await sw.resubscribe();
    expect(sw.subscribed).toEqual([{ userVisibleOnly: true, applicationServerKey: 'KEY' }]);
    expect(sw.messages).toEqual([{ type: 'push-resubscribed' }]);
  });

  it('shows trip notifications as sent', async () => {
    const sw = loadWorker();
    await sw.push({
      kind: 'trip',
      title: 'Alex is at Harris Teeter',
      body: 'Shopping solo with 6 items.',
      tag: 'trip-ht',
    });
    expect(sw.shown[0]).toMatchObject({
      title: 'Alex is at Harris Teeter',
      options: { body: 'Shopping solo with 6 items.' },
    });
  });
});
