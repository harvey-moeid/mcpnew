# Generator Adaptation — Do Not Invent Capabilities

The skill is model-neutral. Do not assert duration, resolution, character-lock, negative-prompt, seed, camera tool, lip-sync, soundtrack, or JSON syntax support without verified model documentation or user-provided actual configuration.

## Decision tree
1. Does the user have a named generator (e.g., Sora, Veo, Kling, Runway, Pika, another product)? If yes, verify current supported inputs/settings if available, then map the storyboard into that generator's format.
2. Is the output image or video? Text-to-image generates stills. Text-to-video generates moving footage. Image-to-video may offer better reference consistency if available; do not silently switch medium.
3. Does the generator support an initial/reference frame? If yes, reuse exact still references where helpful.
4. Does generator support native dialogue/audio? If not or unknown, produce separate speaker/VO and sound track for postproduction.
5. Is duration longer than known per-clip limit? Segment shots, create clip join plan, and preserve continuity.
6. Does the user ask for a final file and render tools aren't available? Be honest: provide prompt + editing workflow; don't invent downloads.

## Portable text-to-video prompt schema
- Identity lock + source image reference if any
- Shot duration and vertical aspect ratio
- Specific single main action
- Location and light
- One camera plan and starting pose
- Last-frame match instruction
- Optional motion exclusions
- Separate spoken audio/text payload

## Prompt portability
Avoid model-specific incantations such as imaginary flags. For tool APIs, follow actual accepted schema. A `negative_prompt` field is only meaningful when supported. For inline GPT image generators, prefer natural-language instructions and exact text overlays if reliable.

## Quality over jargon
A prompt describing a motivated light source, clear composition and coherent physics is more useful than one with many unsupported terms ('16k, hyper ultra, award-winning masterpiece') that obscure the scene.
