import { Fragment, useEffect, useState } from 'react';

import { listRides } from '../../api/rides.js';
import { AsyncState } from '../../components/AsyncState.jsx';
import { FareLabel } from '../../components/FareLabel.jsx';
import { StatusBadge } from '../../components/StatusBadge.jsx';
import { Table, TableBody, TableCell, TableHead, TableRow } from '../../components/ui/Table.jsx';
import { formatDate } from '../../lib/formatDate.js';

const EVENT_LABELS = {
  REQUESTED: 'Requested',
  MATCHED: 'Matched with a driver',
  QUOTE_UPDATED: 'Fare updated',
  DRIVER_ARRIVED: 'Driver arrived',
  PASSENGER_NO_SHOW: 'Marked no-show',
  PASSENGER_CANCELLED: 'Cancelled',
  STARTED: 'Trip started',
  COMPLETED: 'Completed',
  PASSENGER_SELF_COMPLETED: 'Completed',
  DRIVER_FORCE_ENDED: 'Ended by driver',
  CASH_COLLECTED: 'Cash collected',
};

/** The passenger's own ride history: a table that expands to each ride's timeline on click. */
export function PassengerHistory() {
  const [rides, setRides] = useState(undefined);
  const [error, setError] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  // On mount: no synchronous setState in the effect body itself, only in the async .then/.catch.
  useEffect(() => {
    listRides().then(setRides).catch(setError);
  }, []);

  // On retry (from a click handler, not render/effect): resetting the error synchronously here
  // is fine, since it never runs during React's render or commit phase.
  function retry() {
    setError(null);
    listRides().then(setRides).catch(setError);
  }

  return (
    <div>
      <h1 className="mb-4 text-[20px] font-semibold text-text">History</h1>
      <AsyncState
        loading={rides === undefined && !error}
        error={error}
        isEmpty={!!rides && rides.length === 0}
        onRetry={retry}
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
              <Fragment key={ride.id}>
                <TableRow key={ride.id}>
                  <TableCell>
                    <button
                      type="button"
                      className="text-left text-primary transition-colors hover:underline"
                      onClick={() => setExpandedId(expandedId === ride.id ? null : ride.id)}
                    >
                      {formatDate(ride.timeline[0]?.at ?? new Date().toISOString())}
                    </button>
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
                {expandedId === ride.id && (
                  <TableRow key={`${ride.id}-timeline`}>
                    <TableCell />
                    <TableCell>
                      <ol className="flex flex-col gap-1 text-[13px] text-text-muted">
                        {ride.timeline.map((event, index) => (
                          <li key={index}>
                            {formatDate(event.at)} — {EVENT_LABELS[event.type] ?? event.type}
                          </li>
                        ))}
                      </ol>
                    </TableCell>
                    <TableCell />
                    <TableCell />
                  </TableRow>
                )}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </AsyncState>
    </div>
  );
}
