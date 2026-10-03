import type { ReactNode } from 'react';
import { ShieldAlert } from 'lucide-react';
import EmptyState from '../ui/EmptyState';
import { can, useAuth } from '../../stores/authStore';

interface AdminGuardProps {
  /** Admin area: Admin role. Settings: the settings.view permission. */
  permission?: string;
  children: ReactNode;
}

// UX gate only — every endpoint behind these pages enforces its own permission server-side.
export default function AdminGuard({ permission, children }: AdminGuardProps) {
  const { user } = useAuth();
  const allowed = permission ? can(user, permission) : user?.role === 'admin';
  if (!allowed) {
    return (
      <div className="page">
        <EmptyState icon={<ShieldAlert size={22} />} title="Not authorized" description="Your role does not have access to this area. Ask an Admin if you need it." />
      </div>
    );
  }
  return <>{children}</>;
}
