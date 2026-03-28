# Brain CLI Website

Static landing page for the [Brain CLI](https://github.com/vraspar/brain) project.

## Design: "Paper"

Warm, Muji-inspired minimalism with cream backgrounds and sage green accents. Dark code blocks on a light page create the visual signature. No terminal animations, no dark-mode template energy.

## Stack

- Plain HTML + CSS + vanilla JavaScript (~70 lines)
- No frameworks, no build step, no dependencies
- Google Fonts: Inter + JetBrains Mono

## Files

```
website/
+-- index.html      # The page
+-- style.css       # Paper theme
+-- main.js         # Scroll reveal, nav, copy button
+-- README.md       # This file
```

## Local preview

```bash
cd website
npx serve .
# or
python3 -m http.server 8000
```

## Deploy to GitHub Pages

1. Go to Settings > Pages in the GitHub repo
2. Set source to Deploy from a branch
3. Select branch `main` and folder `/website`
4. Save

## Color palette

- Page background: `#faf9f6` (warm cream)
- Card background: `#f2f0ec` (warm gray)
- Accent: `#5a7a64` (muted sage)
- Code blocks: `#2c2c2c` (dark)
- Text: `#3d3d3d` (charcoal)

All color combinations pass WCAG AA.
