# Snoomp Clean Enterprise SaaS Branding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved Clean Enterprise SaaS branding system for Snoomp, including logo updates, design tokens, typography, and double-bezel UI architecture.

**Architecture:** Update `index.html` header branding and font preloads, update CSS variables in `dashboard.css`, replace logo brand representations in `PublicStatusPage.tsx` and `App.tsx` with the new squircle wordmark/icon mark.

**Tech Stack:** React 18, Vite, CSS Variables, Lucide React, Plus Jakarta Sans.

## Global Constraints

- `--bg-void`: `#EAECEF` (Light) / `#08090D` (Dark)
- `--bg-primary`: `#F4F6F8` (Light) / `#0C0D12` (Dark)
- `--bg-secondary`: `#FFFFFF` (Light) / `#181A24` (Dark)
- `--accent`: `#2563EB` (Light) / `#3B82F6` (Dark)
- `--color-up`: `#059669` (Light) / `#238636` (Dark)
- `--color-down`: `#DC2626` (Light) / `#DA3633` (Dark)
- Primary Font: `'Plus Jakarta Sans', system-ui, -apple-system, sans-serif`
- Display Font: `'DM Sans', sans-serif`
- Code Font: `'Noto Sans Mono', 'JetBrains Mono', monospace`

---

### Task 1: Update Brand Favicon and Logo Icon Component

**Files:**
- Modify: `frontend/index.html:5`
- Create: `frontend/src/components/SnoompLogo.tsx`

**Interfaces:**
- Produces: `<SnoompLogo size={number} className={string} showText={boolean} />` SVG component.

- [ ] **Step 1: Create `SnoompLogo.tsx` component with geometric `sn[oo]mp` twin node SVG**

```tsx
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
    <div className={`snoomp-logo-mark ${className}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', userSelect: 'none' }}>
      {/* Icon Mark: Twin Connected Nodes [oo] */}
      <svg width={size} height={size * 0.65} viewBox="0 0 100 65" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="5" y="5" width="42" height="55" rx="14" stroke={color} strokeWidth="10" />
        <rect x="53" y="5" width="42" height="55" rx="14" stroke={color} strokeWidth="10" />
        <line x1="5" y1="32.5" x2="95" y2="32.5" stroke={color} strokeWidth="8" />
      </svg>

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
```

- [ ] **Step 2: Update favicon in `frontend/index.html`**

```html
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 65%22><rect x=%225%22 y=%225%22 width=%2242%22 height=%2255%22 rx=%2214%22 stroke=%22%232563EB%22 stroke-width=%2210%22 fill=%22none%22/><rect x=%2253%22 y=%225%22 width=%2242%22 height=%2255%22 rx=%2214%22 stroke=%22%232563EB%22 stroke-width=%2210%22 fill=%22none%22/><line x1=%225%22 y1=%2232.5%22 x2=%2295%22 y2=%2232.5%22 stroke=%22%232563EB%22 stroke-width=%228%22/></svg>" />
```

---

### Task 2: Align Color Tokens & Double-Bezel CSS Utilities

**Files:**
- Modify: `frontend/src/styles/dashboard.css:10-115`

**Interfaces:**
- Produces: CSS custom properties and `.double-bezel` container styles.

- [ ] **Step 1: Update CSS token variables in `frontend/src/styles/dashboard.css`**

Ensure `:root` (dark mode) and `[data-theme="light"]` contain identical structural variable maps matching the approved spec. Add `.double-bezel` helper styles.

```css
.double-bezel-outer {
  padding: 6px;
  background: var(--bg-void);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-sm);
}

.double-bezel-inner {
  background: var(--bg-secondary);
  border-radius: calc(var(--radius-xl) - 6px);
  padding: 20px;
}
```

---

### Task 3: Integrate `SnoompLogo` and Double-Bezel Layout in Public Status Page and App Header

**Files:**
- Modify: `frontend/src/components/PublicStatusPage.tsx:1-85`
- Modify: `frontend/src/App.tsx:500-550`

**Interfaces:**
- Consumes: `SnoompLogo` from Task 1.

- [ ] **Step 1: Replace default Shield icon with `SnoompLogo` in `PublicStatusPage.tsx`**

Import `SnoompLogo` and render `<SnoompLogo size={36} color="var(--accent)" />` when no custom logo URL is present.

- [ ] **Step 2: Replace navbar logo in `App.tsx` with `SnoompLogo`**

Import `SnoompLogo` in `App.tsx` and replace raw text / shield icon in top left navigation header with `<SnoompLogo size={28} color="var(--accent)" />`.

---

### Task 4: Deploy & Verify Visual Identity

**Files:**
- Executable Verification

- [ ] **Step 1: Restart frontend container to apply build**

Run: `docker restart snoomp-frontend`

- [ ] **Step 2: Verify live site**

Check `http://localhost:5173` and `http://localhost:5173/status/mis-domain` in browser.
