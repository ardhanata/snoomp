import React from 'react';
import type { IconProps as PhosphorIconProps, IconWeight } from '@phosphor-icons/react';

export interface IconComponentProps {
  icon: React.ComponentType<PhosphorIconProps>;
  size?: number | string;
  weight?: IconWeight;
  color?: string;
  className?: string;
  style?: React.CSSProperties;
  'aria-hidden'?: boolean;
  'aria-label'?: string;
}

/**
 * Shared Icon wrapper component enforcing uniform sizing, weight,
 * and neutral color styling across the application.
 */
export const Icon: React.FC<IconComponentProps> = ({
  icon: Component,
  size = 16,
  weight = 'regular',
  color = 'currentColor',
  className = '',
  style,
  'aria-hidden': ariaHidden = true,
  'aria-label': ariaLabel
}) => {
  return (
    <Component
      size={size}
      weight={weight}
      color={color}
      className={`app-icon ${className}`.trim()}
      style={style}
      aria-hidden={ariaHidden}
      aria-label={ariaLabel}
    />
  );
};

export default Icon;
