# REDLINE Design System

Dark, dense, built for a sweaty thumb between sets. Black does the heavy lifting; red is reserved for **action and "you"**. Tokens live in `tokens.css`; this file explains how to use them.

## Principles

1. **One red thing per screen region.** Red marks the primary action, the active state, or your data line. If everything is red, nothing is.
2. **Numbers are the hero.** Weights, reps, timers and stats use Barlow Condensed with tabular figures, set large. Labels stay small and quiet.
3. **Gym-proof touch.** 44px minimum targets, 56px set rows, primary actions in the bottom third of the screen, no system keyboard during a workout.
4. **Color never carries meaning alone.** Red is the brand, so states (miss, deload, capped, error) always pair color with an icon and a word.
5. **Calm until it matters.** Motion and glow are saved for completing a set, hitting a PR and the timer ending.

## Color

### Surfaces
| Token | Hex | Use |
|---|---|---|
| `--bg-0` | #0A0A0B | App background, status bar, manifest theme |
| `--bg-1` | #121214 | Cards, tab bar |
| `--bg-2` | #1A1A1D | Set rows, inputs, sheets |
| `--bg-3` | #242428 | Pressed/selected |
| `--border-1/2` | #2A2A2F / #3A3A40 | Hairlines, dividers, outlined buttons |

Elevation is expressed by lightness, not shadow. Shadows only on bottom sheets.

### Text
| Token | Hex | Contrast | Use |
|---|---|---|---|
| `--text-1` | #F5F5F7 | 18:1 on bg-0 | Primary |
| `--text-2` | #A1A1AA | 6.8:1 on bg-2 | Labels, secondary |
| `--text-3` | #74747E | 3.8:1 on bg-2 | Placeholders and **untouched suggested values** only (they're large numerals, so 3:1 suffices). Never body copy |

### Red
| Token | Hex | Use |
|---|---|---|
| `--red-500` | #E5162A | Primary button fill, active tab icon, superset rail, completed-set check fill. White text on it = 4.7:1 |
| `--red-400` | #FF4757 | Red text/icons on dark, chart primary series (5.9:1 on bg-0) |
| `--red-600` | #B80F20 | Pressed state |
| `--red-tint` | 14% red | Selected chips, active row background, badges |
| `--red-glow` | shadow | Set completion pulse, rest timer finish only |

### Semantic
| State | Token | Pairing |
|---|---|---|
| Progressing | `--success` #30D158 | ↑ arrow + "+5 lb" |
| Holding | `--warning` #FFB224 | = icon + "Hold" |
| Deload suggested | `--warning` | ↓ icon + "Deload" |
| Capped (equipment max) | `--capped` grey | Lock icon + "Capped 50 lb" |
| PR | `--pr` #F5C542 | Trophy/star + "PR" |
| AI draft / sync | `--info` #64A8FF | Sparkle or cloud icon |
| Error / destructive | `--danger` (= red-400) | ⚠ icon + text; destructive buttons are outlined, not filled, so they never look like the primary action |

### Data viz
- Your series: `--viz-primary` (red-400), 2px line, 6px dot on the latest point.
- Comparison / moving average / previous period: `--viz-secondary` grey, or dashed.
- Grid: `--viz-grid`, horizontal lines only. Target bands (e.g. 10–20 sets/muscle) use `--viz-band`.
- Heatmaps (consistency calendar, muscle weeks): 5-step `--heat-0…4` ramp, black → red.
- No rainbow categorical palettes. Muscle-group charts are single-hue bars sorted by value with labels.
- PR points on charts get a `--pr` ring.

## Typography

| Role | Size / line | Font | Weight |
|---|---|---|---|
| Display (rest timer, hero stat) | 56/56 | Barlow Condensed | 700 |
| Number large (stat tiles) | 34/36 | Barlow Condensed | 600 |
| Title (screen) | 28/32 | SF Pro | 700 |
| Heading (exercise/card) | 20/25 | SF Pro | 600 |
| Body | 17/24 | SF Pro | 400 |
| Callout | 15/20 | SF Pro | 400–500 |
| Caption | 13/17 | SF Pro | 400 |
| Micro label | 11/13, uppercase, +0.08em | SF Pro | 600 |

Set-row weight/reps: Barlow Condensed 24px semibold. Units ("lb") rendered smaller in `--text-2` beside the number. Always `font-variant-numeric: tabular-nums` so columns don't jitter.

Self-host Barlow Condensed (SemiBold, Bold) as woff2 and precache it.

## Layout

- 4pt grid; `--gutter` 16px side margins; cards 16px padding, 12px gap between cards.
- Header respects `--safe-top`; tab bar is `56px + --safe-bottom`.
- Screen title large (28px) at top, collapses to a 17px centered title on scroll (iOS pattern).
- Primary CTA either full-width at the bottom (above tab bar) or in the card it belongs to.
- Max content width 560px, centered (for iPad/desktop use).

## Components

**Button** — Primary: red-500 fill, white 17px semibold, 52px tall, `--r-md`. Secondary: bg-2 fill, text-1. Ghost: no fill, red-400 text. Destructive: border-2 outline, red-400 text. Small variant 36px. Pressed = darker fill + scale 0.98.

**Card** — bg-1, `--r-lg`, 16px padding, optional micro label header row with trailing action.

**Set row** — 56px, bg-2, `--r-md`, columns `SET 32px | PREV flex | WEIGHT 76px | REPS 56px | ✓ 44px`. States:
- *Upcoming:* suggested values in `--text-3`.
- *Edited:* values in `--text-1`.
- *Completed:* check fills red-500 with a 200ms spring + brief `--red-glow`; row background shifts to `--red-tint`; values stay text-1.
- *Warm-up:* "W" in place of the set number, text-2, no glow.
- *PR:* gold "PR" micro badge slides in after the reps column.

**Exercise card** — heading + target line ("3 × 8–12 · 45 lb · cap 50" in callout/text-2) + status badge + overflow (⋯). Set rows below; "+ Add set" ghost button at the end.

**Superset group** — 3px red-500 left rail spanning grouped cards; A1/A2 micro labels; one rest timer for the group.

**Badge** — pill, 22px tall, micro text, tint background + matching foreground (red/success/warning/pr/info/capped).

**Keypad sheet** — replaces the system keyboard for weight/reps. Bottom sheet (`--r-xl` top corners) with: field tabs (Weight | Reps), big display value, `−inc` / `+inc` steppers (uses the exercise increment), 3×4 numeric pad (keys 64px tall, bg-2), "Next" advances weight → reps → next set. Shows a lock + "Max 50 lb" hint when the cap is reached; the + stepper disables at cap.

**Rest timer** — Expanded: sheet with a 220px ring (track bg-3, progress red-500), display numerals in the center, −15 / Skip / +15 below. Collapsed: 48px bar above the tab bar with countdown + thin progress line. Last 3 seconds pulse; completion = glow + audio cue.

**Stat tile** — micro label, large number (Barlow 34), optional delta line (success/warning text with arrow) and sparkline.

**Ring meter** — for weekly session goal and nutrition targets. 8px stroke, round caps, red-500 on bg-3 track.

**Segmented control** — bg-2 track, bg-3 selected pill, 36px tall.

**Tab bar** — bg-1 with top hairline, 5 items, 24px icons; active = red-500 icon + text-1 label, inactive = text-3.

**Resume pill** — floating above the tab bar while a workout is active: red-500, elapsed time + current exercise, tap to return.

**AI draft card** — bg-1 with a 1px `--info` border at 40% opacity, sparkle icon, summary line, Review button. Review screen uses the routine editor layout with `--success-tint` for added items and strikethrough for removed ones.

**Empty states** — one line of text-2 + one primary action. No illustrations.

## Iconography
Lucide icons (outline, 1.75px stroke), 24px in nav, 20px inline. Key icons: dumbbell (routines), activity (today), trending-up (progress), scale (body), settings, timer, trophy (PR), lock (capped), sparkles (AI), cloud (sync).

## Motion
| Event | Animation |
|---|---|
| Set complete | Check scale 0.6 → 1 spring (`--ease-spring`, 200ms) + glow fade 320ms |
| PR | Gold badge slide-in + single shimmer |
| Sheets | Slide up 320ms `--ease-out`, scrim fade |
| Timer last 3s | Numeral pulse each second |
| Everything else | 120–200ms opacity/transform only |

All motion disabled under `prefers-reduced-motion`.

## Voice
Short, direct, numbers first. "+5 lb next time." "Hit 12/12/12." "Capped at 50 lb. Try Deficit DB Press?" No exclamation points, no hype copy.
