import { useRef, type CSSProperties, type ReactNode } from 'react';
import { Sheet as SheetRoot, SheetContent, SheetTitle } from './ui/sheet';
import { inkFor, textOn } from '../lib/color';
import type { Member } from '../types';

/** CSS variables for a person's marker: raw color (dark mode) and a readable ink (light mode). */
export function markerStyle(color: string | undefined): CSSProperties {
  if (!color) return {};
  return { '--marker': color, '--marker-ink': inkFor(color) } as CSSProperties;
}

export function Avatar({ member, size = 22 }: { member?: Member; size?: number }) {
  const initial = (member?.name ?? '?').charAt(0).toUpperCase();
  return (
    <span
      className="avatar"
      style={{
        background: member?.color ?? 'var(--muted)',
        color: member?.color ? textOn(member.color) : '#fff',
        width: size,
        height: size,
        fontSize: size * 0.45,
      }}
      aria-label={member?.name}
      title={member?.name}
    >
      {initial}
    </span>
  );
}

/**
 * Bottom sheet, built on the shadcn/ui Sheet (Radix Dialog): focus stays inside while it's
 * open, Escape or a tap outside closes it, and it's announced as a dialog. `labelledBy` names
 * the element (usually the title) that labels it.
 */
export function Sheet({
  title,
  onClose,
  children,
  labelledBy,
}: {
  title?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  labelledBy?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <SheetRoot open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        ref={ref}
        className="sheet"
        overlayClassName="sheet-backdrop"
        aria-labelledby={labelledBy}
        aria-describedby={undefined}
        onOpenAutoFocus={(e) => {
          // Keep focus on a field inside the sheet that focused itself (e.g. the add box);
          // otherwise focus the sheet itself rather than its first button.
          e.preventDefault();
          if (!ref.current?.contains(document.activeElement)) ref.current?.focus();
        }}
      >
        {/* Radix wants a title; the visible one is referenced by labelledBy. */}
        <SheetTitle className="sr-only" />
        <div className="sheet-grab" aria-hidden="true" />
        {title}
        {children}
      </SheetContent>
    </SheetRoot>
  );
}

export function SortIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M4 2v10M1.5 9.5 4 12l2.5-2.5M12 14V4M9.5 6.5 12 4l2.5 2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
