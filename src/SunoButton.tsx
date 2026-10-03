import type { ButtonHTMLAttributes } from 'react';

/** Local button styles share the theme adapter's semantic colors. */
export default function SunoButton({ className = '', children, disabled, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  const primary = className.split(' ').includes('primary') || className === 'play';
  const ghost = /icon-btn|text-btn/.test(className) || !className;
  const variant = primary ? 'primary' : ghost ? 'tertiary-legacy' : 'secondary-legacy';
  return <button {...props} disabled={disabled} data-disabled={disabled ? '' : undefined}
    className={`${className} hxc-btn-base hxc-btn-variant-${variant} hxc-btn-size-mini hxc-btn-shape-pill`}>
    <span aria-hidden="true" className="hxc-btn-overlay-slot hxc-btn-background-slot" />
    <span aria-hidden="true" className="hxc-btn-overlay-slot hxc-btn-border" />
    <span className="hxc-btn-content">{children}</span>
  </button>;
}
