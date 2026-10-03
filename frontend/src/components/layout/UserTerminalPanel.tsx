import { useEffect, useState } from 'react';
import { Lock, LogOut, User } from 'lucide-react';
import { signOut, useAuth } from '../../stores/authStore';

function useOnlineStatus() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

// Signed-in staff and terminal from the server session. Lock ends the session with
// end_reason `lock`; Sign out ends it with `logout` (API §1.8).
export default function UserTerminalPanel() {
  const online = useOnlineStatus();
  const { user } = useAuth();

  return (
    <div className="terminal-panel">
      <span className={`status-pill ${online ? 'status-pill--online' : 'status-pill--offline'}`}>
        <span className="status-dot" />
        {online ? 'Online' : 'Offline'}
      </span>
      <span className="terminal-panel__avatar" title={user?.full_name ?? 'Staff'}>
        <User size={16} />
      </span>
      <span className="terminal-panel__name">{user?.full_name.split(' ')[0] ?? 'Staff'}</span>
      <span className="terminal-panel__terminal">{user?.terminal_id ? `${user.role === 'admin' ? 'Admin' : 'Cashier'} · Terminal` : 'No terminal'}</span>
      <button type="button" className="terminal-panel__lock" title="Lock terminal" onClick={() => void signOut('lock')}>
        <Lock size={16} />
        <span>Lock</span>
      </button>
      <button type="button" className="terminal-panel__lock" title="Sign out" onClick={() => void signOut('logout')}>
        <LogOut size={16} />
        <span>Sign out</span>
      </button>
    </div>
  );
}
