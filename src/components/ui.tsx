import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
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

/** Bottom sheet. Closes on Escape or a tap on the backdrop. */
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    // Keep focus on a field inside the sheet that focused itself (e.g. the add box).
    if (!ref.current?.contains(document.activeElement)) ref.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        ref={ref}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-grab" aria-hidden="true" />
        {title}
        {children}
      </div>
    </div>
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
