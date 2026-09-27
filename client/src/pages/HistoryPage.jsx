import { useAuth } from '../auth/useAuth.js';
import { PassengerHistory } from '../features/history/PassengerHistory.jsx';

/** Renders the passenger or driver history view by role. The driver view is a later unit. */
export function HistoryPage() {
  const { user } = useAuth();

  if (user.role === 'DRIVER') {
    return (
      <div className="mx-auto max-w-2xl px-4 py-6">
        <p className="text-[13px] text-text-muted">Driver history is not built yet in this unit.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <PassengerHistory />
    </div>
  );
}
