---
"@codkit/ui": minor
---

Visual and accessibility pass. Spacing on a 4px grid, a graphite colour ramp with quiet hairlines, weights 400/500, line icons (SVG) instead of text glyphs, and 150ms colour/transform transitions only. The wallet picker is labelled by its title, closes on a click outside it (`closedby="any"`, with a fallback for Safari), keeps the page from scrolling behind it, and fades in unless motion is reduced. The address pill keeps its width when copied and no longer claims a copy the browser refused. Toasts sit in a labelled notifications region in the top layer, show a status icon instead of a coloured edge, and wait while one has focus before auto-dismissing. New: `.ck-button-secondary`, `.ck-field`, `--ck-raised`, `--ck-radius-lg`. Changed: the default `--ck-radius` is 10px (was 12px), and the suggestion row says "Install" with an icon instead of "Install ↗".
