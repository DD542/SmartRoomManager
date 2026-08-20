import { useId, useState } from 'react';
import { cn } from '../../utils/cn';

/**
 * Infobulle déclenchée au survol ET au focus clavier, reliée à son élément par
 * aria-describedby. Purement informative : jamais le seul porteur d'un sens.
 */
export function Tooltip({ label, side = 'top', children, className }) {
  const [open, setOpen] = useState(false);
  const id = useId();

  const positions = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-1.5',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-1.5',
    left: 'right-full top-1/2 -translate-y-1/2 mr-1.5',
    right: 'left-full top-1/2 -translate-y-1/2 ml-1.5',
  };

  return (
    <span
      className={cn('relative inline-flex', className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <span aria-describedby={open ? id : undefined}>{children}</span>
      {open && (
        <span
          role="tooltip"
          id={id}
          className={cn(
            'absolute z-50 w-max max-w-[16rem] rounded-lg border border-line bg-surface-raised px-2 py-1 text-xs text-content',
            positions[side],
          )}
        >
          {label}
        </span>
      )}
    </span>
  );
}
