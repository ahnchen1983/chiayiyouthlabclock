// Phase 7.6 — Firebase Messaging Service Worker
importScripts('https://www.gstatic.com/firebasejs/12.10.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.10.0/firebase-messaging-compat.js');

firebase.initializeApp({
    apiKey: 'AIzaSyBtfIDCclnzR0m63_spNrH9nqOgstMXVf0',
    authDomain: 'chiayiyouthlabclock.firebaseapp.com',
    projectId: 'chiayiyouthlabclock',
    storageBucket: 'chiayiyouthlabclock.firebasestorage.app',
    messagingSenderId: '329063731166',
    appId: '1:329063731166:web:e1bbc8a108991775e4d74f',
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
    const { title, message, link } = payload.data || {};
    self.registration.showNotification(title || '通知', {
        body: message || '',
        data: { link: link || '/' },
    });
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const link = event.notification.data?.link || '/';
    event.waitUntil(clients.openWindow(link));
});
