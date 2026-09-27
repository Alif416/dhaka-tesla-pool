/** @param {{ children: import('react').ReactNode }} props */
export function Table({ children }) {
  return (
    <div className="overflow-x-auto rounded-token border border-border">
      <table className="w-full border-collapse text-left text-[13px]">{children}</table>
    </div>
  );
}

/** @param {{ children: import('react').ReactNode }} props */
export function TableHead({ children }) {
  return <thead className="bg-page text-text-muted">{children}</thead>;
}

/** @param {{ children: import('react').ReactNode }} props */
export function TableBody({ children }) {
  return <tbody>{children}</tbody>;
}

/** @param {{ children: import('react').ReactNode }} props */
export function TableRow({ children }) {
  return <tr className="border-t border-border">{children}</tr>;
}

/** @param {{ children: import('react').ReactNode, header?: boolean }} props */
export function TableCell({ children, header = false }) {
  const Tag = header ? 'th' : 'td';
  return <Tag className="px-3 py-2">{children}</Tag>;
}
