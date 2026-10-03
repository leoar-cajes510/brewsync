import { useEffect, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import LoadingState from '../ui/LoadingState';
import ChangeCredential from './ChangeCredential';
import { bootstrap, useAuth } from '../../stores/authStore';
import './auth.css';

// Gate for the authenticated app shell. The server remains the authority: this only
// routes to Login when there is no session (or it ended: SESSION_EXPIRED/UNAUTHENTICATED).
export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { phase, user } = useAuth();

  useEffect(() => {
    if (phase === 'loading') void bootstrap();
  }, [phase]);

  if (phase === 'loading') {
    return (
      <div className="auth-page">
        <LoadingState label="Loading your session…" />
      </div>
    );
  }
  if (phase !== 'signed-in' || !user) return <Navigate to="/login" replace />;
  if (user.must_change_credential) {
    return (
      <div className="login-page auth-page">
        <ChangeCredential />
      </div>
    );
  }
  return <>{children}</>;
}
