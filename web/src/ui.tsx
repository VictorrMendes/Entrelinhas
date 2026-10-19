/** The Android app's shared pieces (Screens.kt, Material 3): same sizes in dp as px, same type scale, same icons. */
import { type ReactNode, useEffect, useRef } from 'react';

/** A Material icon, the set the Android app draws with: [svg] is its file from @material-design-icons/svg, imported with ?raw. */
export function Icon({ svg, size = 24, className }: { svg: string; size?: number; className?: string }) {
  // the markup comes from the icon package at build time, never from user data
  return <span className={`mi${className ? ` ${className}` : ''}`} style={{ width: size, height: size }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />;
}

/** Centered, 20sp semibold, 24dp above and 20dp below. */
export function ScreenTitle({ children, end }: { children: ReactNode; end?: ReactNode }) {
  return (
    <header className="screen-title">
      <h1>{children}</h1>
      {end && <span className="screen-title-end">{end}</span>}
    </header>
  );
}

/** Choices in a row that scrolls instead of wrapping when they don't fit. */
export function Pills({ options, selected, onSelect }: { options: string[]; selected: number; onSelect: (i: number) => void }) {
  return (
    <div className="pills">
      {options.map((o, i) => (
        <button type="button" key={o} className={`pill${i === selected ? ' on' : ''}`} onClick={() => onSelect(i)}>
          {o}
        </button>
      ))}
    </div>
  );
}

/** Material 3 AlertDialog: title, text and text buttons at the end. */
export function AlertDialog({ title, children, actions, onDismiss }: { title: string; children?: ReactNode; actions: ReactNode; onDismiss: () => void }) {
  return (
    <div className="scrim" onClick={onDismiss}>
      <div className="alert-dialog" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2 className="headline-small">{title}</h2>
        {children && <div className="alert-text body-medium">{children}</div>}
        <div className="alert-actions">{actions}</div>
      </div>
    </div>
  );
}

/** The Android Confirm(): a question with Cancel and the action. */
export function Confirm({ title, text, action = 'Excluir', onConfirm, onDismiss }: { title: string; text: string; action?: string; onConfirm: () => void; onDismiss: () => void }) {
  return (
    <AlertDialog
      title={title}
      onDismiss={onDismiss}
      actions={
        <>
          <button type="button" className="text-button" onClick={onDismiss}>
            Cancelar
          </button>
          <button
            type="button"
            className="text-button"
            onClick={() => {
              onConfirm();
              onDismiss();
            }}
          >
            {action}
          </button>
        </>
      }
    >
      {text}
    </AlertDialog>
  );
}

/** Material 3 DropdownMenu under its anchor; a tap outside closes it. */
export function Menu({ items, onDismiss, start }: { items: { label: string; onClick: () => void }[]; onDismiss: () => void; start?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onDismiss();
    document.addEventListener('pointerdown', close, true);
    return () => document.removeEventListener('pointerdown', close, true);
  }, [onDismiss]);
  return (
    <div ref={ref} className={`menu${start ? ' start' : ''}`} role="menu">
      {items.map((it) => (
        <button
          type="button"
          role="menuitem"
          key={it.label}
          onClick={(e) => {
            e.stopPropagation();
            onDismiss();
            it.onClick();
          }}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

/** A titled group of settings. */
export const Section = ({ children }: { children: ReactNode }) => <h2 className="section-title title-medium">{children}</h2>;

/** A setting as a card: title, then a subtitle under it or a value at the end. */
export function SettingCard({ title, subtitle, value, onClick }: { title: string; subtitle?: string; value?: string; onClick?: () => void }) {
  const content = (
    <>
      <span className="grow">
        <span className="title-medium">{title}</span>
        {subtitle && <span className="body-medium variant setting-subtitle">{subtitle}</span>}
      </span>
      {value && <span className="body-medium variant setting-value">{value}</span>}
    </>
  );
  return onClick ? (
    <button type="button" className="card setting-card" onClick={onClick}>
      {content}
    </button>
  ) : (
    <div className="card setting-card">{content}</div>
  );
}

/** One of several options, each with a hint; picking one closes the dialog. */
export function ChoiceDialog({ title, options, selected, onPick, onDismiss }: { title: string; options: { title: string; subtitle?: string }[]; selected: number; onPick: (i: number) => void; onDismiss: () => void }) {
  return (
    <AlertDialog
      title={title}
      onDismiss={onDismiss}
      actions={
        <button type="button" className="text-button" onClick={onDismiss}>
          Fechar
        </button>
      }
    >
      {options.map((o, i) => (
        <button
          type="button"
          key={o.title}
          className="choice"
          onClick={() => {
            onPick(i);
            onDismiss();
          }}
        >
          <span className={`radio${i === selected ? ' on' : ''}`} />
          <span>
            <span className="title-medium">{o.title}</span>
            {o.subtitle && <span className="body-small variant">{o.subtitle}</span>}
          </span>
        </button>
      ))}
    </AlertDialog>
  );
}

/** 0 follows the device, 1 is always light, 2 always dark (the Android app's theme setting). */
export const appTheme = () => Number(localStorage.getItem('theme') ?? 0);

export function applyTheme(theme = appTheme()) {
  const root = document.documentElement;
  if (theme === 0) delete root.dataset.theme;
  else root.dataset.theme = theme === 1 ? 'light' : 'dark';
}
