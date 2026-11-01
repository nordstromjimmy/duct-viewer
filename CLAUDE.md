# Duct Viewer – notes for Claude

## Language
- **All UI text is Swedish.** Every new button, label, hint, tooltip (`title`), `aria-label`,
  warning, error message, 3D label and exported text must be written in Swedish.
- Use the Swedish trade terms from Crenna's datasheets: ändutförande, isolering, ytskikt,
  utförande, passbit, byggmått, dimensionsförändring, böj, S-böj, övergång, T-stycke,
  avstick, aggregat, ljuddämpare, kulisser, spjäll, lös PG, fläns, nippel, muff, detalj.
- Product codes stay exactly as Crenna writes them (KK-1-1500-1000-0, PG/L, Fast B …).
- Code, identifiers and code comments stay in English.
- Conversation with the user is in English.

## Conventions
- Units are mm. Ducts run along Z, width (bbbb) along X, height (cccc) along Y.
- Stack: Vite + vanilla TypeScript + three.js. Deployed to GitHub Pages by the workflow on push to main.
