# Cross-Asset Consistency Engine

## 4 locks
**BRAND LOCK:** account name, logo treatment (only known logo), tone, CTA, audience, palette with specific color codes if provided, design motifs, typography traits, aspect ratio. Never leak one brand's look into another.

**CHARACTER LOCK:** stable ID, age appearance, hair cut/color, face structure, skin appearance, body silhouette, outfit signature, accessories, baseline voice, gestures, reference image identifiers. Distinguish canonical permanent features from intentionally mutable costume/expression. For minor visual variations acknowledge model limits.

**PRODUCT LOCK:** exact product identity, packaging, color, visible brand or logo as provided, silhouette, visible components, verified capabilities, forbidden false changes.

**WORLD LOCK:** location geography, era, natural/practical light, date/time/weather, set design, character orientation and relative position, scale, recurring props.

## Continuity ledger
Record per shot/slide: number, start/end time (for video), characters and costume version, scene/setting, held objects, character entry/exit, pose at first frame, pose at last frame, text/dialogue, and callback to earlier canon. Copy `assets/continuity-ledger.csv`.

## Visual handoffs
- If shot 2 continues motion, matching last/first keyframes help more than adjectives such as 'keep consistent.'
- One camera movement per short shot; establish geography before closeups where narrative action depends on spatial position.
- If user specifies exact identity from image, prioritize preserving prominent reference traits. Note that identity match is not mathematically guaranteed by pure text prompts.
- To avoid fake UI text, render clean background, add native overlays in edit phase.

## Artifact naming convention (optional)
`BRAND_PROJECT_EP01_SHOT03_v01`, `BRAND_CAROUSEL_SLIDE01_v01`; preserves sequence and avoids confusing unrendered prompt with actual media.

## Handling reference images
User uploads are media references, not permission to misrepresent third parties. Avoid fabricated endorsements. If source has a product label that isn't readable, avoid attempting to reproduce it as a fact.
