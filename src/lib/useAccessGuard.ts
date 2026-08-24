import { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebase';
import { resolveUserRole } from './userRole';
import type { UserRole } from './userRole';

// Reusable page-level access check. Pass the list of role "type" strings
// allowed on this page (e.g. ['master'] or ['master', 'hr']). Returns
// loading=true while the role is still resolving, then allowed=true/false.
// Master is not implicitly allowed everywhere - pass 'master' explicitly
// in allowedRoles for pages master should see.
export function useAccessGuard(allowedRoles: string[]) {
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user?.email) {
        setAllowed(false);
        setLoading(false);
        return;
      }
      const role: UserRole = await resolveUserRole(user.email);
      setAllowed(allowedRoles.includes(role.type));
      setLoading(false);
    });
    return () => unsubscribe();
    // eslint-disable-next-line
  }, []);

  return { loading, allowed };
}
