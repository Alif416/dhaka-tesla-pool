import { useEffect, useState } from 'react';

import { ApiError } from '../../api/client.js';
import { messageForErrorCode } from '../../api/errorMessages.js';
import { createRide, estimateFare } from '../../api/rides.js';
import { listZones } from '../../api/zones.js';
import { useToast } from '../../components/ToastProvider.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Label } from '../../components/ui/Label.jsx';
import { Panel } from '../../components/Panel.jsx';
import { formatPaisa } from '../../lib/formatPaisa.js';

const SELECT_CLASSES =
  'w-full rounded-token border border-border bg-surface px-3 py-2 text-[15px] text-text focus:border-primary focus:outline-none';
const SEAT_OPTIONS = [1, 2, 3];

/**
 * @param {{ onCreated: () => void }} props
 */
export function RequestForm({ onCreated }) {
  const [zones, setZones] = useState([]);
  const [pickupZoneId, setPickupZoneId] = useState('');
  const [destinationZoneId, setDestinationZoneId] = useState('');
  const [seats, setSeats] = useState(1);
  const [estimate, setEstimate] = useState(null);
  const [estimateError, setEstimateError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const { showToast } = useToast();

  useEffect(() => {
    listZones()
      .then(setZones)
      .catch(() => setZones([]));
  }, []);

  const isValidRoute =
    pickupZoneId !== '' && destinationZoneId !== '' && pickupZoneId !== destinationZoneId;

  // No synchronous setState here for the invalid case: an unfinished pair simply means the
  // estimate/error below aren't shown (gated by isValidRoute at render time), rather than
  // resetting state from inside the effect body.
  useEffect(() => {
    if (!isValidRoute) {
      return undefined;
    }
    let cancelled = false;
    estimateFare({
      pickupZoneId: Number(pickupZoneId),
      destinationZoneId: Number(destinationZoneId),
      seats,
    })
      .then((result) => {
        if (!cancelled) {
          setEstimate(result);
          setEstimateError(null);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setEstimate(null);
          setEstimateError(error);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isValidRoute, pickupZoneId, destinationZoneId, seats]);

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    try {
      await createRide({
        pickupZoneId: Number(pickupZoneId),
        destinationZoneId: Number(destinationZoneId),
        seats,
      });
      onCreated();
    } catch (error) {
      showToast(
        error instanceof ApiError ? messageForErrorCode(error.code) : 'Something went wrong.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = isValidRoute && estimate && !submitting;

  return (
    <Panel title="Request a ride">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <Label htmlFor="pickup-zone">Pickup</Label>
          <select
            id="pickup-zone"
            className={SELECT_CLASSES}
            value={pickupZoneId}
            onChange={(event) => setPickupZoneId(event.target.value)}
          >
            <option value="">Select a zone</option>
            {zones.map((zone) => (
              <option key={zone.id} value={zone.id}>
                {zone.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="destination-zone">Destination</Label>
          <select
            id="destination-zone"
            className={SELECT_CLASSES}
            value={destinationZoneId}
            onChange={(event) => setDestinationZoneId(event.target.value)}
          >
            <option value="">Select a zone</option>
            {zones.map((zone) => (
              <option key={zone.id} value={zone.id}>
                {zone.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="seats">Seats</Label>
          <select
            id="seats"
            className={`${SELECT_CLASSES} w-24`}
            value={seats}
            onChange={(event) => setSeats(Number(event.target.value))}
          >
            {SEAT_OPTIONS.map((count) => (
              <option key={count} value={count}>
                {count}
              </option>
            ))}
          </select>
        </div>
        {isValidRoute && estimate && (
          <p className="text-[15px] text-text">
            Estimated fare: <span className="font-medium">{formatPaisa(estimate.amountPaisa)}</span>
          </p>
        )}
        {isValidRoute && estimateError && (
          <p className="text-[13px] text-danger">{messageForErrorCode(estimateError.code)}</p>
        )}
        <Button type="submit" disabled={!canSubmit}>
          Request ride
        </Button>
      </form>
    </Panel>
  );
}
