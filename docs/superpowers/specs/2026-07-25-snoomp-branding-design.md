# Snoomp Clean Enterprise SaaS Branding Specification

**Date:** 2026-07-25  
**Status:** Approved  
**Brand Archetype:** Clean Enterprise SaaS (Connected Node System)  

---

## 1. Executive Summary & Brand Purpose

Snoomp is an enterprise-grade infrastructure, network, and status monitoring platform. The visual identity balances high trust, extreme clarity, daylight legibility, and refined dark-mode operational ergonomics.

---

## 2. Core Symbolism & Logo Architecture

### 2.1 Logo Concept (`sn[oo]mp`)
The Snoomp logo is a custom geometric squircle wordmark in lowercase. 
- **The Twin Node Metaphor (`[oo]`):** The central double 'o' glyphs merge into a bisected twin-node frame representing **connected monitors, continuous uptime, and dual-redundancy tracking**.
- **Standalone Icon Mark:** The twin node `[oo]` squircle module isolates into a standalone app icon, favicon, security badge, and navigation mark.
- **Stroke Geometry:** Uniform line weights with 8px inner squircle radii and 14px outer corner curves.

---

## 3. Color Token System

The color system enforces WCAG 4.5:1 daylight legibility without OLED eye strain.

### 3.1 Light Mode Tokens (Default)
| Token | Hex Value | Purpose |
|---|---|---|
| `--bg-void` | `#EAECEF` | Page backdrop / outer gutter |
| `--bg-primary` | `#F4F6F8` | Main content canvas |
| `--bg-secondary` | `#FFFFFF` | Elevated card inner core |
| `--text-primary` | `#181A1C` | Primary typography |
| `--text-muted` | `#6C7078` | Secondary & sub-header labels |
| `--accent` | `#2563EB` | Electric Azure brand accent |
| `--color-up` | `#059669` | Operational Status UP |
| `--color-down` | `#DC2626` | Incident Status DOWN |
| `--color-warning` | `#D97706` | Warning Status DEGRADED |

### 3.2 Dark Mode Tokens (Night Ops)
| Token | Hex Value | Purpose |
|---|---|---|
| `--bg-void` | `#08090D` | Deep charcoal void |
| `--bg-primary` | `#0C0D12` | Dark canvas |
| `--bg-secondary` | `#181A24` | Elevated card inner core |
| `--text-primary` | `#F4F5FB` | Crisp off-white text |
| `--text-muted` | `#8B92AA` | Muted steel gray |
| `--accent` | `#3B82F6` | Vibrant Azure accent |
| `--color-up` | `#238636` | Operational Status UP |
| `--color-down` | `#DA3633` | Incident Status DOWN |
| `--color-warning` | `#D29922` | Warning Status DEGRADED |

---

## 4. Typography Hierarchy

- **Wordmark & Identity Mark:** Custom squircle geometric vector text (`sn[oo]mp`).
- **Display & Headings (H1 - H3):** `DM Sans` / `Outfit` (Weight 700, tracking `-0.02em`).
- **Body UI & Navigation:** `Plus Jakarta Sans` (Weight 400 - 600, clean grotesk).
- **Technical Metrics & IP Data:** `JetBrains Mono` / `Noto Sans Mono` (Monospace alignment).

---

## 5. UI Component Architecture & Double-Bezel

1. **Double-Bezel Card Enclosure:**
   - Outer shell (`rounded-[24px]` / `1.5rem`) with 1px hairline border (`var(--border)`).
   - Inner core (`rounded-[18px]` / `calc(1.5rem - 0.375rem)`) with `bg-secondary` background.
2. **Pill Action CTAs:**
   - Fully rounded interactive buttons (`rounded-full`) with nested trailing icon pods (`w-6 h-6 rounded-full bg-black/10` / `bg-white/10`).
3. **Eyebrow Status Badges:**
   - Uppercase microscopic sub-labels (`text-[10px] tracking-[0.18em] font-bold text-muted`).

---

## 6. Verification & Self-Review Checklist

- [x] **Placeholder Scan:** No TBD, TODO, or vague statements.
- [x] **Internal Consistency:** Light and Dark mode tokens mirror each other perfectly.
- [x] **Scope Check:** Focused purely on branding specification and visual design system.
- [x] **Ambiguity Check:** Explicit hex codes, font stacks, and component rules defined.
