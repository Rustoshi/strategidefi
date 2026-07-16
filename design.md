# StrategiDeFi — Design System

Extracted from the live **user dashboard** (the Vue/uni‑app trading app at `/app`) so the
public homepage matches the product 1:1. Source of truth: the dashboard's computed styles,
the home chunk's scoped CSS, and the tab‑bar theme config.

---

## 1. Theme

The dashboard is a **dark, single‑theme** interface — near‑black surfaces with one warm
**gold** accent and blue/green/red data colors. There is **no light mode** and **no CSS
gradients** (flat fills only; the one gradient on screen is baked into the banner image).
The homepage should commit to this same dark theme — do **not** add a light mode or a
theme toggle.

## 2. Color tokens

| Token | Hex | Use |
|---|---|---|
| `--bg` | `#0E0F12` | page background (the dominant dashboard surface) |
| `--surface` | `#161922` | elevated sections / bands |
| `--card` | `#232734` | cards, panels (measured `#282C38`, tuned) |
| `--line` | `#2C3140` | hairline borders / dividers |
| `--text` | `#FFFFFF` | primary text |
| `--muted` | `#9FA6B5` | secondary text, labels |
| `--gold` | `#F0C947` | **brand accent** — CTAs, highlights, active tab (from tab‑bar `selectedBackgroundColor`) |
| `--gold-soft` | `#FFDB5C` | lighter gold (hover / glow) |
| `--gold-ink` | `#211900` | text on gold fills |
| `--up` | `#3FBF54` | price up / positive (dashboard greens `#48C23D` / `#1F7647`) |
| `--down` | `#EA3131` | price down / negative (dashboard reds `#EA3131` / `#E64340`) |

Accent rule: gold is the **only** brand color and is spent sparingly (buttons, one word in
the headline, active states, numbers of note). Green/red are **semantic only** (never brand).

## 3. Typography

The dashboard ships **no custom web font** — it renders in the platform system sans stack.
To match, the homepage uses the same system stack (not a downloaded display face):

```
--font: -apple-system, "PingFang SC", "Helvetica Neue", Helvetica, system-ui,
        Roboto, Arial, "Microsoft YaHei", sans-serif;
--mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
```

- **Numbers** (prices, balances, %s) use `--mono` with `font-variant-numeric: tabular-nums`
  — this is the dashboard's data vernacular.
- Headings: heavy weight (700–800), tight tracking (`-0.02em`).
- Body: 400–500 weight; labels are uppercase mono with wide tracking on the dashboard.

## 4. Banner image

The dashboard hero/carousel banner is:

```
/upload/images/7242a168693352707f6b10f88d2834fd.jpg   (1024×510)  "FINANCIAL GROWTH"
```

A deep **navy‑blue** trading chart — cyan candlesticks over a gold/yellow trend line on a
dark blue field. A second carousel slide exists
(`/upload/images/cbb038716af94e6a9d2b1a0e395371b7.jpg`, 1280×500) but the FINANCIAL GROWTH
chart is the signature one and should anchor the homepage hero.

The navy of the banner reads as a cooler cousin of `--bg`; frame it with a `--line` border
and let the gold accent tie it to the trend line inside the image.

## 5. Components (as seen on the dashboard)

- **Cards / panels**: `--card` fill, `1px --line` border, `~14–18px` radius, generous padding.
- **Primary button**: solid `--gold` fill, `--gold-ink` text, `~11px` radius.
- **Secondary button**: transparent, `1px --line` border, `--text`; hover → gold border/text.
- **Balance / stat**: mono, tabular, large; label above in muted uppercase mono.
- **Rows / list items**: hairline separation, hover raises to `--card`.
- **Market pills**: symbol + mono price + green/red mono delta.

## 6. Homepage direction (derived from the above)

- Dark `--bg` everything; flat fills, no CSS gradients.
- **Hero** = product headline + Sign up / Log in, with the **FINANCIAL GROWTH banner image**
  as the hero visual (bordered card), gold accent on one headline word.
- Sections (Products: Spot/Options/Contracts · Assets dashboard · Security) all on the dark
  theme with `--card` panels and gold accents — visually continuous with `/app`.
- Numbers in mono; green/red only for deltas; gold only for brand/CTA.
