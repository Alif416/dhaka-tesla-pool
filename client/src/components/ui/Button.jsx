const VARIANT_CLASSES = {
  primary: 'bg-primary text-white border-primary hover:bg-primary/90',
  secondary: 'bg-surface text-text border-border hover:bg-page',
  danger: 'bg-surface text-danger border-danger hover:bg-danger/10',
};

/**
 * @param {{ variant?: 'primary' | 'secondary' | 'danger', children: import('react').ReactNode }
 *   & import('react').ButtonHTMLAttributes<HTMLButtonElement>} props
 */
export function Button({ variant = 'primary', className = '', children, ...rest }) {
  return (
    <button
      className={`rounded-token border px-4 py-2 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT_CLASSES[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
