// Service worker minimo: serve solo a mostrare le notifiche degli avvisi di vendita anche sui telefoni
// (dove new Notification() non è disponibile) e a riaprire l'app toccando la notifica. Nessuna cache.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) if ('focus' in c) return c.focus();
      return self.clients.openWindow('./');
    }),
  );
});
