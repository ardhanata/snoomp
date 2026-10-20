import React from 'react';
import { normalizeTag } from '../utils/tags';

export type TagColorPreset = 'violet' | 'teal' | 'magenta' | 'indigo' | 'sky' | 'slate';

export const TAG_COLOR_PRESETS: TagColorPreset[] = [
  'violet',
  'teal',
  'magenta',
  'indigo',
  'sky',
  'slate'
];

export interface TagColorsDefinition {
  dark: { bg: string; text: string; border: string };
  light: { bg: string; text: string; border: string };
}

export const TAG_COLORS: Record<TagColorPreset, TagColorsDefinition> = {
  violet: {
    dark: { bg: '#2a2147', text: '#cbb8ff', border: '#43357a' },
    light: { bg: '#efe9ff', text: '#4b2bb0', border: '#cdbff5' }
  },
  teal: {
    dark: { bg: '#0f2f33', text: '#7fe0d4', border: '#1d5a60' },
    light: { bg: '#def5f1', text: '#0b5f58', border: '#a5ddd6' }
  },
  magenta: {
    dark: { bg: '#3a1d33', text: '#ff9fd8', border: '#6b2f5c' },
    light: { bg: '#fde6f3', text: '#9c1f6b', border: '#f3b6d9' }
  },
  indigo: {
    dark: { bg: '#1d2547', text: '#a9bcff', border: '#34428a' },
    light: { bg: '#e6ebff', text: '#2a3fb0', border: '#b9c4f5' }
  },
  sky: {
    dark: { bg: '#0f2a3a', text: '#86d3ff', border: '#1d5473' },
    light: { bg: '#e0f3ff', text: '#075985', border: '#a8d8f5' }
  },
  slate: {
    dark: { bg: '#232833', text: '#c5ccdb', border: '#3a4152' },
    light: { bg: '#eceff4', text: '#3b4558', border: '#cfd5e0' }
  }
};

/**
 * Checks whether a given string is a valid 7-character hex color code.
 */
export function isCustomHex(val?: string | null): boolean {
  return typeof val === 'string' && /^#[0-9a-fA-F]{6}$/.test(val.trim());
}

/**
 * Computes accessible theme-aware background, border and high-contrast text colours
 * from a user-supplied hex colour for TagChip.
 */
export function computeCustomTagColors(hex: string, isLightMode: boolean): { bg: string; text: string; border: string } {
  const cleanHex = hex.trim();
  const r = parseInt(cleanHex.slice(1, 3), 16) || 59;
  const g = parseInt(cleanHex.slice(3, 5), 16) || 130;
  const b = parseInt(cleanHex.slice(5, 7), 16) || 246;

  if (isLightMode) {
    const textR = Math.round(r * 0.60);
    const textG = Math.round(g * 0.60);
    const textB = Math.round(b * 0.60);
    return {
      bg: `rgba(${r}, ${g}, ${b}, 0.12)`,
      border: `rgba(${r}, ${g}, ${b}, 0.35)`,
      text: `#${textR.toString(16).padStart(2, '0')}${textG.toString(16).padStart(2, '0')}${textB.toString(16).padStart(2, '0')}`
    };
  } else {
    const textR = Math.min(255, Math.round(r * 1.35 + 45));
    const textG = Math.min(255, Math.round(g * 1.35 + 45));
    const textB = Math.min(255, Math.round(b * 1.35 + 45));
    return {
      bg: `rgba(${r}, ${g}, ${b}, 0.18)`,
      border: `rgba(${r}, ${g}, ${b}, 0.45)`,
      text: `#${textR.toString(16).padStart(2, '0')}${textG.toString(16).padStart(2, '0')}${textB.toString(16).padStart(2, '0')}`
    };
  }
}

/**
 * Computes or resolves preset colour for a tag name.
 * Auto (default): sum of char codes modulo 6 in order [violet, teal, magenta, indigo, sky, slate]
 * Exceptions: 'prod' is Violet, 'mis-bpdlh' is Teal.
 */
export function resolveTagColor(
  tagName: string,
  tagColorsMap?: Record<string, TagColorPreset | string>
): TagColorPreset {
  const norm = normalizeTag(tagName);
  if (tagColorsMap && tagColorsMap[norm]) {
    const val = tagColorsMap[norm] as TagColorPreset;
    if (TAG_COLOR_PRESETS.includes(val)) {
      return val;
    }
  }

  // Explicit exceptions from spec
  if (norm === 'prod') return 'violet';
  if (norm === 'mis-bpdlh') return 'teal';

  // Auto hash formula
  let sum = 0;
  for (let i = 0; i < norm.length; i++) {
    sum += norm.charCodeAt(i);
  }
  const idx = Math.abs(sum) % TAG_COLOR_PRESETS.length;
  return TAG_COLOR_PRESETS[idx];
}

interface TagChipProps {
  tag: string;
  tagColorsMap?: Record<string, TagColorPreset | string>;
  isLight?: boolean;
  className?: string;
  onClick?: () => void;
  onRemove?: () => void;
  selected?: boolean;
  style?: React.CSSProperties;
}

/**
 * Shared <TagChip> component adhering to Snoomp Redesign build instructions.
 * Chip shape: 1px border, 6px radius, 0 8px padding, 12px font-size, 500 font-weight.
 */
export const TagChip: React.FC<TagChipProps> = ({
  tag,
  tagColorsMap,
  isLight,
  className = '',
  onClick,
  onRemove,
  selected = false,
  style
}) => {
  const norm = normalizeTag(tag);
  const customOverride = tagColorsMap?.[norm];

  const isLightMode = isLight !== undefined
    ? isLight
    : (typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'light');

  let colorDef: { bg: string; text: string; border: string };
  if (isCustomHex(customOverride)) {
    colorDef = computeCustomTagColors(customOverride!, isLightMode);
  } else {
    const preset = resolveTagColor(tag, tagColorsMap);
    colorDef = TAG_COLORS[preset][isLightMode ? 'light' : 'dark'];
  }

  const chipStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    padding: '0 8px',
    height: '24px',
    minHeight: '24px',
    fontSize: '12px',
    fontWeight: 500,
    lineHeight: '22px',
    borderRadius: '6px',
    border: `1px solid ${colorDef.border}`,
    backgroundColor: colorDef.bg,
    color: colorDef.text,
    cursor: onClick ? 'pointer' : 'default',
    userSelect: 'none',
    whiteSpace: 'nowrap',
    fontFamily: 'inherit',
    boxShadow: selected ? `0 0 0 2px var(--accent-text)` : undefined,
    transition: 'opacity 0.15s ease, transform 0.15s ease',
    ...style
  };

  const removeButton = onRemove ? (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onRemove();
      }}
      aria-label={`Remove tag ${tag}`}
      style={{
        background: 'none',
        border: 'none',
        color: 'inherit',
        cursor: 'pointer',
        padding: 0,
        display: 'inline-flex',
        alignItems: 'center',
        fontSize: '11px',
        opacity: 0.7,
        marginLeft: '4px'
      }}
      onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
      onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.7'; }}
    >
      &times;
    </button>
  ) : null;

  if (onClick) {
    if (onRemove) {
      // Avoid nesting <button> inside <button>: render container <span> with sibling buttons
      return (
        <span
          className={`tag-chip tag-chip--composite ${selected ? 'is-selected' : ''} ${className}`.trim()}
          style={{ ...chipStyle, cursor: 'default', padding: '0 4px 0 8px' }}
        >
          <button
            type="button"
            className="tag-chip__action"
            aria-pressed={selected}
            onClick={onClick}
            style={{
              background: 'none',
              border: 'none',
              color: 'inherit',
              padding: 0,
              font: 'inherit',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center'
            }}
          >
            {tag}
          </button>
          {removeButton}
        </span>
      );
    }

    return (
      <button
        type="button"
        className={`tag-chip tag-chip--interactive ${selected ? 'is-selected' : ''} ${className}`.trim()}
        aria-pressed={selected}
        onClick={onClick}
        style={chipStyle}
      >
        <span>{tag}</span>
      </button>
    );
  }

  return (
    <span
      className={`tag-chip ${selected ? 'is-selected' : ''} ${className}`.trim()}
      style={chipStyle}
    >
      <span>{tag}</span>
      {removeButton}
    </span>
  );
};

export default TagChip;
