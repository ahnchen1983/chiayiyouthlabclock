import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
    apiKey: "AIzaSyBtfIDCclnzR0m63_spNrH9nqOgstMXVf0",
    authDomain: "chiayiyouthlabclock.firebaseapp.com",
    projectId: "chiayiyouthlabclock",
    storageBucket: "chiayiyouthlabclock.firebasestorage.app",
    messagingSenderId: "329063731166",
    appId: "1:329063731166:web:e1bbc8a108991775e4d74f",
    measurementId: "G-J469QM2EC3"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
// Firestore 已移除：所有資料操作改走 Netlify Functions + Admin SDK
