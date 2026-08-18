import type { ReactNode } from 'react';
import { formatMoney, formatSigned, type Money } from '../scoring';

/**
 * The shared control vocabulary, ported from `Theme/Components.swift`.
 * Everything interactive clears the 48px gloved-thumb minimum, and the bet
 * color language (up = money lime, down = coral, halved = neutral) is applied
 * in exactly one place so it stays consistent everywhere.
 */

export function standingColor(cents: number): string {
  if (cents > 0) return 'text-money';
  if (cents < 0) return 'text-down';
  return 'text-neutral';
}

interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'md' | 'lg';
  disabled?: boolean;
  className?: string;
  type?: 'button' | 'submit';
  ariaLabel?: string;
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  size = 'md',
  disabled = false,
  className = '',
  type = 'button',
  ariaLabel,
}: ButtonProps) {
  const base =
    'tap inline-flex items-center justify-center gap-2 rounded-button font-semibold transition-transform active:scale-[0.97] disabled:opacity-40 disabled:active:scale-100';
  const sizes = {
    md: 'px-4 py-3 text-headline',
    lg: 'px-6 py-4 text-title w-full',
  };
  const variants = {
    primary: 'bg-fairway text-text-onAccent active:bg-fairway-pressed',
    secondary: 'bg-raised text-text-primary border border-stroke',
    ghost: 'text-text-secondary',
    danger: 'bg-raised text-down border border-down/40',
  };
  return (
    <button
      type={type}
      aria-label={ariaLabel}
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Card({
  children,
  className = '',
  raised = false,
}: {
  children: ReactNode;
  className?: string;
  raised?: boolean;
}) {
  return (
    <div className={`${raised ? 'card-raised' : 'card'} ${className}`}>{children}</div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-caption uppercase tracking-wider text-text-secondary px-1">
      {children}
    </h2>
  );
}

/** Money rendered with tabular digits, colored by the standings language. */
export function MoneyText({
  cents,
  signed = false,
  size = 'md',
  className = '',
}: {
  cents: Money;
  signed?: boolean;
  size?: 'md' | 'lg';
  className?: string;
}) {
  const text = signed ? formatSigned(cents) : formatMoney(cents);
  const sizeClass = size === 'lg' ? 'text-money-lg' : 'text-headline font-bold';
  return (
    <span className={`tnum ${sizeClass} ${standingColor(cents)} ${className}`}>
      {text}
    </span>
  );
}

export function Chip({
  children,
  selected = false,
  onClick,
  className = '',
}: {
  children: ReactNode;
  selected?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  const selectedClass = selected
    ? 'bg-fairway text-text-onAccent border-fairway'
    : 'bg-raised text-text-secondary border-stroke';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`tap px-4 py-2 rounded-chip border text-headline transition-colors active:scale-[0.97] ${selectedClass} ${className}`}
    >
      {children}
    </button>
  );
}

export function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="tap w-full flex items-center justify-between gap-4 px-4 py-3 text-left"
    >
      <span className="min-w-0">
        <span className="block text-body text-text-primary">{label}</span>
        {hint && <span className="block text-caption text-text-secondary">{hint}</span>}
      </span>
      <span
        className={`shrink-0 w-12 h-7 rounded-full transition-colors relative ${
          checked ? 'bg-fairway' : 'bg-stroke'
        }`}
      >
        <span
          className={`absolute top-1 w-5 h-5 rounded-full bg-text-primary transition-transform ${
            checked ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </span>
    </button>
  );
}

/** Row of the standings/leaderboard type: name on the left, value on the right. */
export function Row({
  leading,
  title,
  subtitle,
  trailing,
  onClick,
  className = '',
}: {
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  const content = (
    <>
      {leading && <span className="shrink-0 text-title">{leading}</span>}
      <span className="min-w-0 flex-1">
        <span className="block text-body text-text-primary truncate">{title}</span>
        {subtitle && (
          <span className="block text-caption text-text-secondary truncate">
            {subtitle}
          </span>
        )}
      </span>
      {trailing && <span className="shrink-0">{trailing}</span>}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`tap w-full flex items-center gap-3 px-4 py-3 text-left active:bg-raised transition-colors ${className}`}
      >
        {content}
      </button>
    );
  }
  return (
    <div className={`flex items-center gap-3 px-4 py-3 ${className}`}>{content}</div>
  );
}

export function EmptyState({
  emoji,
  title,
  message,
}: {
  emoji: string;
  title: string;
  message: string;
}) {
  return (
    <div className="text-center px-8 py-12">
      <div className="text-5xl mb-3">{emoji}</div>
      <div className="text-title text-text-primary mb-1">{title}</div>
      <div className="text-body text-text-secondary">{message}</div>
    </div>
  );
}

/** Screen scaffold: fixed header, scrolling body, optional footer. */
export function Screen({
  title,
  subtitle,
  onBack,
  action,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  action?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex flex-col h-full bg-background">
      <header className="safe-top px-4 pb-3 flex items-center gap-3 border-b border-stroke shrink-0">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="tap -ml-2 flex items-center justify-center text-text-secondary text-title"
          >
            ‹
          </button>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="text-title truncate">{title}</h1>
          {subtitle && (
            <p className="text-caption text-text-secondary truncate">{subtitle}</p>
          )}
        </div>
        {action}
      </header>
      <main className="flex-1 overflow-y-auto overscroll-contain">{children}</main>
      {footer && (
        <footer className="safe-bottom px-4 pt-3 border-t border-stroke shrink-0 bg-background">
          {footer}
        </footer>
      )}
    </div>
  );
}
