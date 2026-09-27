import { listRides } from '../../api/rides.js';
import { usePolling } from '../../hooks/usePolling.js';

const ACTIVE_STATUSES = ['REQUESTED', 'MATCHED', 'DRIVER_ARRIVED', 'STARTED'];

/**
 * Polls the passenger's own rides and derives the current active one, if any.
 * @returns {{ currentRide: object | null, rides: object[] | undefined, error: Error | null,
 *   loading: boolean, refetch: () => void }}
 */
export function useCurrentRide() {
  const { data: rides, error, loading, refetch } = usePolling(() => listRides());
  const currentRide = rides?.find((ride) => ACTIVE_STATUSES.includes(ride.status)) ?? null;
  return { currentRide, rides, error, loading, refetch };
}
