import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js';
import { getFunctions } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-functions.js';

const firebaseConfig = {
  apiKey: 'AIzaSyCRa76LiXlBo2KG-lOFV32RVSVHm0L56uQ',
  authDomain: 'hs-bokseong.firebaseapp.com',
  projectId: 'hs-bokseong',
  storageBucket: 'hs-bokseong.firebasestorage.app',
  messagingSenderId: '923295250107',
  appId: '1:923295250107:web:43ec7bbeefd7cc564cdb9e',
  measurementId: 'G-H56C0TJGFM'
};

export const app = initializeApp(firebaseConfig, 'reservation-web');
export const auth = getAuth(app);
export const db = getFirestore(app, 'reservation');
export const functions = getFunctions(app, 'asia-northeast3');

