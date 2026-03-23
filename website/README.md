# Brain CLI Website

Static landing page for the [Brain CLI](https://github.com/vraspar/brain) project.

## Stack

- Plain HTML + CSS + vanilla JavaScript
- No frameworks, no build step, no dependencies
- Google Fonts: JetBrains Mono + Inter

## Files

```
website/
├── index.html      # The entire page
├── style.css       # All styles
├── terminal.js     # Terminal typing animation (~170 lines)
└── README.md       # This file
```

## Local preview

Open `index.html` in a browser, or use any static server:

```bash
cd website
npx serve .
# or
python3 -m http.server 8000
```

## Deploy to GitHub Pages

### Option 1: From `website/` directory

1. Go to **Settings → Pages** in the GitHub repo
2. Set source to **Deploy from a branch**
3. Select branch `main` and folder `/website`
4. Save — site deploys to `https://vraspar.github.io/brain/`

### Option 2: Copy to `docs/` (if Pages requires it)

```bash
cp -r website/ docs/website/
git add docs/website/
git commit -m "deploy: website to GitHub Pages"
git push
```

Then configure Pages to serve from `/docs/website`.

## Design

Based on the Phosphor design spec. Dark monochrome theme with green (#4ade80) accent. All color combinations pass WCAG AA, most pass AAA.
