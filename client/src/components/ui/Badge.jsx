/**
 * @param {{ variant?: 'neutral' | 'warning' | 'success' | 'danger',
 *   children: import('react').ReactNode }} props
 */
export function Badge({ variant = 'neutral', children }) {
  const variantClasses = {
    neutral: 'bg-page text-text-muted border-border',
    warning: 'bg-warning/10 text-warning border-warning/30',
    success: 'bg-success/10 text-success border-success/30',
    danger: 'bg-danger/10 text-danger border-danger/30',
  }[variant];
  return (
    <span
      className={`inline-block rounded-token border px-2 py-0.5 text-[13px] font-medium ${variantClasses}`}
    >
      {children}
    </span>
  );
}
