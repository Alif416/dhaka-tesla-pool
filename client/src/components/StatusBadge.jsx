import { Badge } from './ui/Badge.jsx';

const VARIANT_BY_STATUS = {
  REQUESTED: 'neutral',
  MATCHED: 'neutral',
  DRIVER_ARRIVED: 'neutral',
  STARTED: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'danger',
};

/** @param {{ status: string }} props */
export function StatusBadge({ status }) {
  return <Badge variant={VARIANT_BY_STATUS[status] ?? 'neutral'}>{status}</Badge>;
}
