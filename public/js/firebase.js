import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-app-check.js';
import { initializeAuth, browserLocalPersistence } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js';
import { getFunctions } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-functions.js';

// Firebase Console > 프로젝트 설정 > 내 앱 > SDK 설정 및 구성에서 복사한 값을 입력하세요.
// 현재 값은 임시 Firebase 프로젝트 jw-astro09의 reservation Web App 설정입니다.
export const firebaseConfig = {
  apiKey: 'AIzaSyA6TNIpMYl_vFgbMy3C9MXjucuC27pVFgE',
  authDomain: 'jw-astro09.firebaseapp.com',
  databaseURL: 'https://jw-astro09-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'jw-astro09',
  storageBucket: 'jw-astro09.firebasestorage.app',
  messagingSenderId: '351054210545',
  appId: '1:351054210545:web:151282cae2c10534759050',
  measurementId: 'G-DBDYBT1X4V'
};

// App Check를 사용할 때 Firebase Console에서 발급한 reCAPTCHA Enterprise 사이트 키를 입력하세요.
// 빈 문자열이면 App Check 초기화를 건너뜁니다.
export const recaptchaEnterpriseSiteKey = '';

export const app = initializeApp(firebaseConfig);
export const appCheck = recaptchaEnterpriseSiteKey
  ? initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(recaptchaEnterpriseSiteKey),
      isTokenAutoRefreshEnabled: true
    })
  : null;
export const auth = initializeAuth(app, { persistence: browserLocalPersistence });
export const db = getFirestore(app, 'reservation');
export const functions = getFunctions(app, 'asia-northeast3');
