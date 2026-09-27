import { useState } from 'react';

import { ApiError } from '../../api/client.js';
import { messageForErrorCode } from '../../api/errorMessages.js';
import { cancelRide, completeRide } from '../../api/rides.js';
import { FareLabel } from '../../components/FareLabel.jsx';
import { Panel } from '../../components/Panel.jsx';
import { StatusBadge } from '../../components/StatusBadge.jsx';
import { useToast } from '../../components/ToastProvider.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog.jsx';

const CANCELLABLE_STATUSES = ['REQUESTED', 'MATCHED', 'DRIVER_ARRIVED'];

/**
 * @param {{ ride: object, onChanged: () => void }} props
 */
export function ActiveRideCard({ ride, onChanged }) {
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [pending, setPending] = useState(false);
  const { showToast } = useToast();

  async function run(action) {
    setPending(true);
    try {
      await action();
      onChanged();
    } catch (error) {
      showToast(
        error instanceof ApiError ? messageForErrorCode(error.code) : 'Something went wrong.',
      );
      onChanged();
    } finally {
      setPending(false);
    }
  }

  const seatsLabel = ride.seats > 1 ? `${ride.seats} seats` : '1 seat';
  const sharedLabel =
    ride.sharedPassengerCount > 0
      ? `Shared with ${ride.sharedPassengerCount} other${ride.sharedPassengerCount > 1 ? 's' : ''}`
      : null;

  return (
    <Panel>
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-text">Active ride</h2>
        <StatusBadge status={ride.status} />
      </div>
      <p className="mt-3 text-[15px] text-text">
        {ride.pickup} → {ride.destination} · {seatsLabel}
      </p>
      {ride.driver && (
        <p className="mt-1 text-[13px] text-text-muted">
          Driver {ride.driver.name}
          {ride.vehicle && ` · Vehicle ${ride.vehicle.name}`}
        </p>
      )}
      <div className="mt-2 flex items-center justify-between">
        <FareLabel fare={ride.fare} />
        {sharedLabel && <span className="text-[13px] text-text-muted">{sharedLabel}</span>}
      </div>
      <div className="mt-4 flex gap-2">
        {CANCELLABLE_STATUSES.includes(ride.status) && (
          <Button variant="secondary" disabled={pending} onClick={() => setConfirmingCancel(true)}>
            Cancel ride
          </Button>
        )}
        {ride.status === 'STARTED' && (
          <Button disabled={pending} onClick={() => run(() => completeRide(ride.id))}>
            I&rsquo;ve arrived
          </Button>
        )}
      </div>
      <ConfirmDialog
        open={confirmingCancel}
        title="Cancel this ride?"
        description="This cannot be undone."
        confirmLabel="Cancel ride"
        onConfirm={() => {
          setConfirmingCancel(false);
          run(() => cancelRide(ride.id));
        }}
        onCancel={() => setConfirmingCancel(false)}
      />
    </Panel>
  );
}
