import { Button } from './ui/Button.jsx';

/**
 * Loading / error / empty wrapper for a data view. `loading` should only be true on the first
 * load (callers keep the previous good data visible during a background poll refresh).
 * @param {{ loading: boolean, error: Error | null, isEmpty: boolean, onRetry?: () => void,
 *   emptyMessage?: string, children: import('react').ReactNode }} props
 */
export function AsyncState({
  loading,
  error,
  isEmpty,
  onRetry,
  emptyMessage = 'Nothing here yet.',
  children,
}) {
  if (loading) {
    return <p className="text-[13px] text-text-muted">Loading…</p>;
  }
  if (error) {
    return (
      <div className="flex items-center gap-3 text-[13px] text-danger">
        <span>Something went wrong loading this.</span>
        {onRetry && (
          <Button variant="secondary" onClick={onRetry}>
            Retry
          </Button>
        )}
      </div>
    );
  }
  if (isEmpty) {
    return <p className="text-[13px] text-text-muted">{emptyMessage}</p>;
  }
  return children;
}
