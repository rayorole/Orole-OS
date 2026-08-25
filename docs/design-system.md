# Orole-OS Design System

Dark-mode-first HUD ("mission control") system built on shadcn/ui primitives
with customized CSS variables. Single source of truth:
`src/styles.css`. This is the foundation for all wave-3 feature UI.

## Theme

- **Dark only.** There is no light theme and no theme toggle; `<html>` always
  carries `class="dark"` and `color-scheme: dark`.
- Neutrals are deep-space oklch tones (`--background` ≈ L 0.145, `--card` ≈
  L 0.18). Borders are 1px subtle strokes at ~12% white.
- Background has a faint grid + top radial glow — ambient, never competing
  with content.

## Palette

| Token | Value (oklch) | Use |
| --- | --- | --- |
| `--background` / `--foreground` | 0.145 / 0.93 (hue 265 / 200) | page |
| `--card` | 0.18, hue 260 | panels |
| `--primary` | 0.82 0.16 195 (neon cyan) | primary actions, active accents |
| `--secondary` | 0.55 0.18 300 (plasma violet) | secondary accents |
| `--accent` | 0.30 0.05 210 | hovers, ghost fills |
| `--destructive` | 0.63 0.22 25 (red) | failed state + destructive actions |
| `--neon-cyan` / `--neon-violet` | accent utilities (`text-neon-cyan`) | display type, kickers |
| `--chart-1..5` | cyan, violet, green, amber, red | analytics series |

## Typography

Intentional HUD pair, loaded via `@theme`:

- **UI:** Geist (falls back to Inter → system sans).
- **Data / terminal:** JetBrains Mono — used for labels, statuses, timestamps,
  and anything machine-generated (`.hud-panel-title`, badges, nav links).

## Status colors (standardized)

| Status | Token | Tailwind class | Meaning |
| --- | --- | --- | --- |
| running | `--status-running` (green) | `text-status-running`, `bg-status-running` | live / healthy |
| pending | `--status-pending` (amber) | `text-status-pending` | queued / in-flight |
| failed | `--status-failed` (= red destructive) | `text-status-failed` | error |
| idle | `--status-idle` (= muted-foreground) | `text-status-idle` | dormant |

Use the shared primitives instead of hand-rolled colors:

- `<Badge variant="running|pending|failed|idle">` — tinted border/bg/text chip.
- `<StatusDot status={...} />` — small dot; glow + pulse reserved for
  `running` only (live state).

**Glow rule:** neon glows (`shadow-[0_0_Npx_var(--*-glow)]`) are reserved for
live/active elements. Static chrome stays flat.

## Component rules

1. Every UI element uses a shadcn/ui primitive (`src/components/ui/*`):
   Button, Card, Badge, and future Tabs/Dialog/Sheet/Tooltip. No one-off
   styled divs where a primitive exists; no third-party component kits.
2. Extend components by adding variants to their `cva()` config, not by
   wrapping them in bespoke markup.
3. Layout helpers: `.hud-page` (max-width container), `.hud-panel-title`
   (mono kicker label). Spacing scale is Tailwind defaults (4px base).
4. Radii: `--radius` = 0.625rem drives all `rounded-*` tokens; don't invent
   new radii inline.

## Route audit checklist

Every route under `src/routes/` must:

- [x] exist intentionally (no scaffold/demo routes)
- [x] consume design-system tokens/components only
- [x] contain no starter placeholder markup or copy
- [x] render correctly at desktop width

Current audit: `/` (mission control home) — compliant.
