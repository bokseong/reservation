importScripts('https://www.gstatic.com/firebasejs/13.2.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/13.2.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyA6TNIpMYl_vFgbMy3C9MXjucuC27pVFgE',
  authDomain: 'jw-astro09.firebaseapp.com',
  projectId: 'jw-astro09',
  storageBucket: 'jw-astro09.firebasestorage.app',
  messagingSenderId: '351054210545',
  appId: '1:351054210545:web:151282cae2c10534759050'
});

const messaging = firebase.messaging();
messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || '복성고 먹거리 · 조리 완료';
  const options = {
    body: payload.notification?.body || '음식이 준비됐어요. 지금 받아 주세요.',
    data: { link: payload.fcmOptions?.link || payload.data?.link || 'https://bokseong.github.io/reservation/' },
    tag: payload.data?.reservationId || 'bokseong-reservation-ready'
  };
  self.registration.showNotification(title, options);
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data?.link || 'https://bokseong.github.io/reservation/'));
});
