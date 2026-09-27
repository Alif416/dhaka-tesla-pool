import { formatPaisa } from '../lib/formatPaisa.js';

/** @param {{ fare: { amountPaisa: number, kind: 'ESTIMATE' | 'FINAL' } }} props */
export function FareLabel({ fare }) {
  const label = fare.kind === 'FINAL' ? 'Final' : 'Estimated';
  return (
    <span className="text-[15px] text-text">
      {formatPaisa(fare.amountPaisa)} <span className="text-[13px] text-text-muted">{label}</span>
    </span>
  );
}
