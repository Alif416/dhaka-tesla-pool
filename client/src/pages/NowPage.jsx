import { useAuth } from '../auth/useAuth.js';
import { ActiveRideCard } from '../features/passenger/ActiveRideCard.jsx';
import { RecentRides } from '../features/passenger/RecentRides.jsx';
import { RequestForm } from '../features/passenger/RequestForm.jsx';
import { useCurrentRide } from '../features/passenger/useCurrentRide.js';

/** Renders the passenger or driver "Now" view by role. The driver view is a later unit. */
export function NowPage() {
  const { user } = useAuth();

  if (user.role === 'DRIVER') {
    return (
      <div className="mx-auto max-w-2xl px-4 py-6">
        <p className="text-[13px] text-text-muted">
          The driver dashboard is not built yet in this unit.
        </p>
      </div>
    );
  }

  return <PassengerNow />;
}

function PassengerNow() {
  const { currentRide, rides, error, loading, refetch } = useCurrentRide();
  const pastRides = rides?.filter((ride) => ride.id !== currentRide?.id) ?? [];

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-6">
      {currentRide ? (
        <ActiveRideCard ride={currentRide} onChanged={refetch} />
      ) : (
        <RequestForm onCreated={refetch} />
      )}
      <RecentRides rides={pastRides} loading={loading} error={error} onRetry={refetch} />
    </div>
  );
}
