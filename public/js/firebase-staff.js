import { app } from './firebase.js?v=20261117-1';
import { initializeAuth, browserLocalPersistence, browserPopupRedirectResolver } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js';

// 직원·관리자 화면에서만 필요한 Firebase 제품을 지연 분리합니다.
export const auth = initializeAuth(app, {
  persistence: browserLocalPersistence,
  popupRedirectResolver: browserPopupRedirectResolver
});
export const db = getFirestore(app, 'reservation');
