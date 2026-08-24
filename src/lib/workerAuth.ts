import { initializeApp, deleteApp } from 'firebase/app';
import {
  getAuth as getSecondaryAuth,
  createUserWithEmailAndPassword,
} from 'firebase/auth';

const firebaseConfig = {
  apiKey: 'AIzaSyCGgUJNRgC2Mx_5gZbZqWVK2UuJBaZw3yo',
  authDomain: 'manpower-management-5e29c.firebaseapp.com',
  projectId: 'manpower-management-5e29c',
  storageBucket: 'manpower-management-5e29c.firebasestorage.app',
  messagingSenderId: '781986664508',
  appId: '1:781986664508:web:dc9407e9e0858eb34cb339',
};

const WORKER_EMAIL_DOMAIN = 'worker.manpower-app.local';

export function workerEmailFor(employeeCode: string) {
  return `${employeeCode.toLowerCase()}@${WORKER_EMAIL_DOMAIN}`;
}

// All worker credential-creation logic lives here, isolated from HR.tsx and
// the future worker check-in page. If the login method changes later
// (e.g. face verification instead of code+phone), only this function needs
// to change.
export async function createWorkerLogin(employeeCode: string, mobile: string) {
  if (!mobile || mobile.length < 6) {
    throw new Error(
      'Mobile number must be at least 6 digits to use as a login password.'
    );
  }
  const email = workerEmailFor(employeeCode);
  const secondaryApp = initializeApp(
    firebaseConfig,
    `worker-create-${Date.now()}`
  );
  const secondaryAuth = getSecondaryAuth(secondaryApp);
  try {
    await createUserWithEmailAndPassword(secondaryAuth, email, mobile);
  } catch (err: any) {
    if (err.code !== 'auth/email-already-in-use') {
      await deleteApp(secondaryApp);
      throw err;
    }
  }
  await deleteApp(secondaryApp);
}
