import React from 'react';

interface SnoompLogoProps {
  size?: number;
  showText?: boolean;
  color?: string;
  className?: string;
}

export const SnoompLogo: React.FC<SnoompLogoProps> = ({
  size = 28,
  showText = true,
  color = 'currentColor',
  className = ''
}) => {
  return (
    <div className={`snoomp-logo-mark ${className}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '11px', userSelect: 'none' }}>
      {/* Icon Mark: Twin Connected Nodes [oo] */}
      <svg width={size} height={size * 0.65} viewBox="0 0 100 65" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect x="5" y="5" width="42" height="55" rx="14" stroke={color} strokeWidth="10" />
        <rect x="53" y="5" width="42" height="55" rx="14" stroke={color} strokeWidth="10" />
        <line x1="5" y1="32.5" x2="95" y2="32.5" stroke={color} strokeWidth="8" />
      </svg>
      {!showText && <span className="sr-only">Snoomp</span>}

      {showText && (
        <span style={{
          fontFamily: 'var(--font-header)',
          fontSize: `${size * 0.85}px`,
          fontWeight: 800,
          letterSpacing: '-0.03em',
          color: 'var(--text-primary)'
        }}>
          snoomp
        </span>
      )}
    </div>
  );
};
export default SnoompLogo;
