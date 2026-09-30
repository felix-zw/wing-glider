# Shared basalt material

The project-owned bitmap `surfaces/stone-fracture-source.png` was generated using the **built-in Imagegen tool**. No remote image is needed at runtime. The unmodified generated source is retained; the bake and compression steps are reproducible from this file.

Prompt:

> Use case: photorealistic-natural. Asset type: seamless tileable PBR rock material base color source for an asteroid video game, SQUARE 2048x2048 texture, no border or text. Completely fills the image with one continuous natural DARK CHARCOAL BASALT rocky substrate, many irregular angular fracture plates of wildly varying sizes, layered chipped edges and smaller granular rocky aggregate in fissures, broad hard facets interleaved with eroded crushed surfaces. Looks like a superb photogrammetry scanned rugged fractured asteroid rock face. This is a FLAT ORTHOGRAPHIC SURFACE TEXTURE, not a photo of a freestanding rock, no horizon, no background. Neutral cool charcoal grey with subtle brown mineral weathering. Random broken plates with strong readable irregular crevice topology and fine mineral grain. Soft omnidirectional diffuse illumination suitable for reuse as a material with dynamic light, no directional cast shadow, no highlights or ambient scene lighting. Variation at multiple scales. Avoid smooth blobs, regular cellular patterns, equal-sized pebbles, repetitive cracks, cross-shaped fissures, brickwork, cartoon polygon outlines, and anything that resembles paving stones. Consistent sharp microdetail across the whole surface. TILEABLE with matching opposite edges.

Build:

```sh
python tools/generate-stone.py
node tools/encode-stone.mjs
```

The three 1024² UASTC KTX2 maps share a complete mip chain. Colour uses sRGB; normal and packed data use linear sampling. Packed channels are **R = occlusion, G = roughness, B = displacement height**, unlike the planet maps whose blue channel is metalness. The normal, occlusion and roughness are artistic estimates from the source, not measured scan data.

`src/stone-material.ts` projects these maps along three local axes, with independent offsets, multiple scales and painted host/fracture/weathering/colour blends. High and Standard use the same material, with different geometric displacement amplitudes. The depth material applies the same offset. Small visual displacement does not enter flight collision or mining support validation.
