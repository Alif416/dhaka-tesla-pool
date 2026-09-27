/**
 * @param {import('react').InputHTMLAttributes<HTMLInputElement>} props
 */
export function Input({ className = '', ...rest }) {
  return (
    <input
      className={`w-full rounded-token border border-border bg-surface px-3 py-2 text-[15px] text-text placeholder:text-text-muted focus:border-primary focus:outline-none ${className}`}
      {...rest}
    />
  );
}
