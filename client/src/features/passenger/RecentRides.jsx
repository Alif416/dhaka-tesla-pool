import { AsyncState } from '../../components/AsyncState.jsx';
import { FareLabel } from '../../components/FareLabel.jsx';
import { StatusBadge } from '../../components/StatusBadge.jsx';
import { Table, TableBody, TableCell, TableHead, TableRow } from '../../components/ui/Table.jsx';
import { formatDate } from '../../lib/formatDate.js';

/**
 * @param {{ rides: object[] | undefined, loading: boolean, error: Error | null,
 *   onRetry?: () => void }} props
 */
export function RecentRides({ rides, loading, error, onRetry }) {
  return (
    <div>
      <h2 className="mb-2 text-[15px] font-semibold text-text">Recent rides</h2>
      <AsyncState
        loading={loading}
        error={error}
        isEmpty={!rides || rides.length === 0}
        onRetry={onRetry}
        emptyMessage="No rides yet."
      >
        <Table>
          <TableHead>
            <TableRow>
              <TableCell header>Date</TableCell>
              <TableCell header>Route</TableCell>
              <TableCell header>Status</TableCell>
              <TableCell header>Fare</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rides?.map((ride) => (
              <TableRow key={ride.id}>
                <TableCell>
                  {formatDate(ride.timeline[0]?.at ?? new Date().toISOString())}
                </TableCell>
                <TableCell>
                  {ride.pickup} → {ride.destination}
                </TableCell>
                <TableCell>
                  <StatusBadge status={ride.status} />
                </TableCell>
                <TableCell>
                  <FareLabel fare={ride.fare} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </AsyncState>
    </div>
  );
}
