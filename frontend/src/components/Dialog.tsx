import React, { useEffect, useRef } from 'react';

export interface DialogProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  'aria-labelledby'?: string;
}

export default function Dialog({ isOpen, onClose, children, className, style, 'aria-labelledby': ariaLabelledBy }: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen) {
      if (!dialog.open) {
        dialog.showModal();
        // Focus the first input or heading, avoiding the close button
        setTimeout(() => {
          const firstInput = dialog.querySelector('input:not([type="hidden"]), textarea, select');
          const firstHeading = dialog.querySelector('h1, h2, h3, h4');
          if (firstInput) {
            (firstInput as HTMLElement).focus();
          } else if (firstHeading) {
            firstHeading.setAttribute('tabIndex', '-1');
            (firstHeading as HTMLElement).style.outline = 'none';
            (firstHeading as HTMLElement).focus();
          }
        }, 0);
      }
    } else {
      if (dialog.open) {
        dialog.close();
      }
    }
  }, [isOpen]);

  const handleCancel = () => {
    // Let the native dialog close happen to restore focus, just sync state
    onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      className={className}
      style={style}
      aria-labelledby={ariaLabelledBy}
      onCancel={handleCancel}
    >
      {isOpen && (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          {children}
        </div>
      )}
    </dialog>
  );
}
