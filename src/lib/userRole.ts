// lib/userRole.ts
import { db } from '../firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';

const MASTER_EMAIL = 'dhipri77@gmail.com';

export type UserRole =
  | { type: 'master' }
  | { type: 'pm'; projectId: string; projectName: string }
  | { type: 'hr' }
  | { type: 'accountant' }
  | { type: 'unknown' };

// Determines what a logged-in email is allowed to see. Checked in order:
// master (hardcoded) -> PM (matches a project's managerEmail) -> HR/Accountant
// (matches a staffRoles doc) -> unknown (no access anywhere).
export async function resolveUserRole(email: string): Promise<UserRole> {
  if (email === MASTER_EMAIL) {
    return { type: 'master' };
  }

  const projQ = query(
    collection(db, 'projects'),
    where('managerEmail', '==', email)
  );
  const projSnap = await getDocs(projQ);
  if (!projSnap.empty) {
    const proj = projSnap.docs[0];
    return {
      type: 'pm',
      projectId: proj.id,
      projectName: (proj.data() as any).name,
    };
  }

  const staffQ = query(
    collection(db, 'staffRoles'),
    where('email', '==', email)
  );
  const staffSnap = await getDocs(staffQ);
  if (!staffSnap.empty) {
    const role = (staffSnap.docs[0].data() as any).role;
    if (role === 'hr') return { type: 'hr' };
    if (role === 'accountant') return { type: 'accountant' };
  }

  return { type: 'unknown' };
}
