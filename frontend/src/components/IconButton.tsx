import React, { forwardRef } from 'react';

export type IconButtonVariant =
  | 'accent'
  | 'success'
  | 'danger'
  | 'warning'
  | 'purple'
  | 'cyan'
  | 'neutral';

export type IconButtonSize = 'sm' | 'md' | 'lg';

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: React.ReactNode;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  title: string;
  'aria-label'?: string;
  active?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(({
  icon,
  variant = 'neutral',
  size = 'md',
  title,
  'aria-label': ariaLabel,
  active = false,
  className = '',
  type = 'button',
  disabled,
  ...props
}, ref) => {
  const classes = [
    'icon-btn',
    `icon-btn--${variant}`,
    `icon-btn--${size}`,
    active ? 'active' : '',
    className
  ].filter(Boolean).join(' ');

  return (
    <button
      ref={ref}
      type={type}
      className={classes}
      title={title}
      aria-label={ariaLabel || title}
      disabled={disabled}
      {...props}
    >
      {icon}
    </button>
  );
});

IconButton.displayName = 'IconButton';

export default IconButton;
