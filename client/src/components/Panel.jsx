/**
 * A bordered section with a heading. Used only to group related controls, per code-standards.md
 * — everything else is plain rows and tables.
 * @param {{ title?: string, children: import('react').ReactNode }} props
 */
export function Panel({ title, children }) {
  return (
    <section className="rounded-token border border-border bg-surface p-4">
      {title && <h2 className="mb-3 text-[15px] font-semibold text-text">{title}</h2>}
      {children}
    </section>
  );
}
