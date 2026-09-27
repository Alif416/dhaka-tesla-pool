/**
 * @param {import('react').LabelHTMLAttributes<HTMLLabelElement>} props
 */
export function Label({ className = '', children, ...rest }) {
  return (
    <label className={`mb-1 block text-[13px] font-medium text-text ${className}`} {...rest}>
      {children}
    </label>
  );
}
