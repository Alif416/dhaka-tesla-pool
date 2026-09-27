import { NavLink } from 'react-router-dom';

import { useAuth } from '../auth/useAuth.js';

const LINK_CLASSES = ({ isActive }) =>
  `text-[13px] transition-colors ${isActive ? 'text-primary font-medium' : 'text-text-muted hover:text-text'}`;

/** The only navigation in the app: no sidebar, per ui-context.md. */
export function TopBar() {
  const { user, logout } = useAuth();

  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-6">
          <span className="text-[15px] font-semibold text-primary">RidePool</span>
          <nav className="flex gap-4">
            <NavLink to="/" className={LINK_CLASSES} end>
              Now
            </NavLink>
            <NavLink to="/history" className={LINK_CLASSES}>
              History
            </NavLink>
          </nav>
        </div>
        {user && (
          <div className="flex items-center gap-3 text-[13px] text-text-muted">
            <span>
              {user.name} · {user.role === 'DRIVER' ? 'Driver' : 'Passenger'}
            </span>
            <button
              type="button"
              onClick={logout}
              className="text-text-muted transition-colors hover:text-text"
            >
              Logout
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
