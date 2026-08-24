import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: 'AIzaSyCGgUJNRgC2Mx_5gZbZqWVK2UuJBaZw3yo',
  authDomain: 'manpower-management-5e29c.firebaseapp.com',
  projectId: 'manpower-management-5e29c',
  storageBucket: 'manpower-management-5e29c.firebasestorage.app',
  messagingSenderId: '781986664508',
  appId: '1:781986664508:web:dc9407e9e0858eb34cb339',
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);
