/* Stocked push handling. Loaded into the generated service worker via importScripts. */

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Stocked', body: event.data ? event.data.text() : '' };
  }

  event.waitUntil(
    (async () => {
      const tag = data.tag || data.kind || 'stocked';
      let title = data.title || 'Stocked';
      let body = data.body || '';
      let items = Array.isArray(data.items) ? data.items : [];

      // Several quick adds become one notification: "Sam added 5 items". The relay sends the
      // real count; item names may be a shortened list.
      let count = typeof data.count === 'number' ? data.count : items.length;
      if (data.kind === 'adds' && data.actor) {
        const existing = await self.registration.getNotifications({ tag });
        for (const n of existing) {
          const prev = (n.data && n.data.items) || [];
          const prevCount = (n.data && n.data.count) || prev.length;
          items = prev.concat(items.filter((i) => !prev.includes(i)));
          count += prevCount;
          n.close();
        }
        count = Math.max(count, items.length, 1);
        title =
          count > 1
            ? `${data.actor} added ${count} items`
            : `${data.actor} added ${items[0] || 'an item'}`;
        body = items.slice(0, 20).join(', ') + (count > items.length && items.length ? ', …' : '');
      }

      await self.registration.showNotification(title, {
        body,
        tag,
        renotify: true,
        icon: '/icon-192.png',
        badge: '/badge-96.png',
        data: { url: data.url || '/', items, count },
      });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(
    (event.notification.data && event.notification.data.url) || '/',
    self.location.origin,
  ).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if ('focus' in client) {
          await client.focus();
          if ('navigate' in client) await client.navigate(url).catch(() => undefined);
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});

// Push services sometimes rotate a subscription. Subscribe again with the same key and tell any
// open app to save the new one (it also re-saves on every launch).
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      const key =
        (event.oldSubscription &&
          event.oldSubscription.options &&
          event.oldSubscription.options.applicationServerKey) ||
        null;
      if (key && !event.newSubscription) {
        await self.registration.pushManager
          .subscribe({ userVisibleOnly: true, applicationServerKey: key })
          .catch(() => undefined);
      }
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) client.postMessage({ type: 'push-resubscribed' });
    })(),
  );
});
