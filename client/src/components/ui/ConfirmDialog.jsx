import { useEffect, useRef } from 'react';

import { Button } from './Button.jsx';

/**
 * A native <dialog>-based confirmation modal, per code-standards.md section 11.2. Used only for
 * Cancel ride, Cancel pool, End Trip and No-show.
 * @param {{ open: boolean, title: string, description: string, confirmLabel?: string,
 *   onConfirm: () => void, onCancel: () => void }} props
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  onConfirm,
  onCancel,
}) {
  const dialogRef = useRef(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      onCancel={onCancel}
      className="rounded-token border border-border p-0 backdrop:bg-black/30"
    >
      <div className="w-80 p-4">
        <h2 className="text-[15px] font-semibold text-text">{title}</h2>
        <p className="mt-2 text-[13px] text-text-muted">{description}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>
            Never mind
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
