# Mode I — Text-to-Image Prompt Engineering

## Workflow
1. Confirm concrete subject (who/what), mood, narrative function, style, realism, reference assets, vertical ratio, and whether text must appear.
2. Establish invariant look across frames with a **visual identity lock**: skin and hair appearance for characters, material/color/branding for products, recurring set design for scenes.
3. Draft prompt using a single coherent visual concept: subject, visible action and expression; shot framing and lens feel; location/props; lighting direction and palette; aesthetic/materials; composition including space for UI/text; explicit preservation rules.
4. When multiple images are requested, vary scene, pose, framing, and storytelling, not identity. Use distinct prompts per slide/asset. Do not recycle one generic prompt.
5. Use negative prompts only if relevant to the chosen model. Avoid promises that prompt text can guarantee identical faces.

## Reusable English template
```
A vertical 9:16 [photo/3D render/illustration] of [precise identity and subject],
performing [one clearly visualized action] in [concrete location with stable props].
Expression and gesture: [details]. Composition: [medium/wide/close shot, angle,
foreground/background separation, important negative space]. Lighting: [source,
direction, intensity, ambience]. Palette and materials: [specific], aesthetic:
[visual identity]. Preserve from reference: [unchanged features].
No unintended text, watermarks, visual artifacts, duplicate objects or invented logos.
```

## Character consistency system
- Create a reference/character sheet with front, three-quarter and profile views when requested and technically available.
- Keep a canonical identity paragraph, wardrobe catalog and forbidden mutations; apply the paragraph unchanged across shots.
- Prefer still-keyframes for subsequent image-to-video when visual continuity matters.
- Do not invent identity beyond the user's supplied image without saying it is a creative interpretation.

## Product accuracy
Match packaging, shape, visible label, color and accessories to the user's photos. Do not hallucinate prices, ingredients, dimensions, certifications, or unverified claims. If a detail cannot be read, either omit it or ask for a detail only if central to the request.

## Advanced visual styles
- Mystic editorial: controlled nebula/light gradients, premium gold accents, legibility over glow.
- Realistic UGC: natural daylight, smartphone perspective, imperfect but credible styling, authentic hand anatomy.
- Cinematic drama: blocking, motivated source light, coherent environment geography, restrained depth of field.
- Miniature diorama: consistent physical scale, material roughness, intentional studio light and believable toy props.
