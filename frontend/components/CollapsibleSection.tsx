'use client';
import { useState, ReactNode } from 'react';

interface Props {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  /** Outer container class. Default = `border-t` (used on detail pages with internal sections). */
  containerClassName?: string;
  /** Class for the body wrapper when open. */
  bodyClassName?: string;
  /** Class for the header button. */
  headerClassName?: string;
  children: ReactNode;
}

export default function CollapsibleSection({
  title,
  count,
  defaultOpen = true,
  containerClassName = 'border-t',
  bodyClassName = 'p-4 pt-0',
  headerClassName = 'w-full flex justify-between items-center p-4 hover:bg-gray-50 text-left',
  children,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={containerClassName}>
      <button
        onClick={() => setOpen(o => !o)}
        className={headerClassName}
      >
        <h2 className="font-semibold">
          {title}
          {count !== undefined && count > 0 && (
            <span className="ml-2 text-sm text-gray-500">({count})</span>
          )}
        </h2>
        <span className="text-gray-400">{open ? '▲' : '▼'}</span>
      </button>
      {open && <div className={bodyClassName}>{children}</div>}
    </div>
  );
}
