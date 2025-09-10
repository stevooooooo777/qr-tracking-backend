// sw.js - Save this file in your public/ directory

const CACHE_NAME = 'table-intelligence-v1';

// Install Service Worker
self.addEventListener('install', function(event) {
  self.skipWaiting();
});

// Activate Service Worker
self.addEventListener('activate', function(event) {
  self.clients.claim();
});

// Handle push notifications from your server
self.addEventListener('push', function(event) {
  if (!event.data) return;

  try {
    const data = event.data.json();
    console.log('Push notification received:', data);

    const options = {
      body: data.body,
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      vibrate: [300, 100, 300, 100, 300],
      requireInteraction: true,
      tag: data.tag || 'table-alert',
      data: {
        tableNumber: data.tableNumber,
        alertId: data.alertId,
        type: data.type,
        url: data.url || '/'
      },
      actions: [
        {
          action: 'acknowledge',
          title: 'Mark Resolved',
          icon: '/favicon.ico'
        },
        {
          action: 'view',
          title: 'View Table',
          icon: '/favicon.ico'
        }
      ]
    };

    // Show notification
    event.waitUntil(
      self.registration.showNotification(data.title, options)
    );

    // Send confirmation back to server
    fetch('/api/notifications/delivered', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        alertId: data.alertId,
        deliveredAt: new Date().toISOString()
      })
    }).catch(err => console.log('Delivery confirmation failed:', err));

  } catch (error) {
    console.error('Error handling push notification:', error);
    
    // Fallback notification
    event.waitUntil(
      self.registration.showNotification('Service Request', {
        body: 'A customer needs assistance',
        icon: '/favicon.ico',
        vibrate: [300, 100, 300]
      })
    );
  }
});

// Handle notification clicks
self.addEventListener('notificationclick', function(event) {
  event.notification.close();

  if (event.action === 'acknowledge') {
    // Mark alert as resolved
    event.waitUntil(
      fetch('/api/service/resolve/' + event.notification.data.alertId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resolvedBy: 'mobile-notification',
          resolvedAt: new Date().toISOString()
        })
      }).then(response => {
        if (response.ok) {
          self.registration.showNotification('Alert Resolved', {
            body: `Table ${event.notification.data.tableNumber} request marked as resolved`,
            icon: '/favicon.ico',
            tag: 'resolved-confirmation'
          });
        }
      }).catch(error => {
        console.error('Failed to resolve alert:', error);
      })
    );
  } else {
    // Open or focus the app
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
        const url = event.notification.data.url || '/';
        
        // Check if app is already open
        for (let client of clientList) {
          if (client.url.includes('table-control-center.html') && 'focus' in client) {
            return client.focus();
          }
        }
        
        // Open new window
        if (clients.openWindow) {
          return clients.openWindow('/table-control-center.html?mobile=true');
        }
      })
    );
  }
});