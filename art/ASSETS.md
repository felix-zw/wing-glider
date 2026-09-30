# Wing Glider original assets and build pipeline

The speeder and ATLAS are original meshes and materials authored for this repository from the approved concept images in `output/mockups`. They contain no downloaded models, textures or fonts. Lettering uses Blender's built-in Bfont converted to geometry. No external attribution or runtime service is required.

## Source and rebuild

- `speeder.blend` and `atlas.blend` contain the editable exported asset hierarchy plus a studio camera and lighting setup.
- `previews/speeder.png` and `previews/atlas.png` are actual Cycles renders of these models, not concept art.
- `../tools/art/build_assets.py` preserves the unmerged component definitions and reproduces both Blender projects, GLBs, manifests and previews. Static geometry is joined by material and parent before export to keep draw calls low. The mining turret remains an independent transform.

From the repository root, with Blender 5.2 installed:

```sh
npm run art:models
npm run art:validate
```

The launcher uses `blender` on PATH. If Blender is installed elsewhere, set the `BLENDER` environment variable to its executable, for example `$env:BLENDER = 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe'` in PowerShell. Append `-- speeder` or `-- atlas` to `npm run art:models` to rebuild only one model. Direct use is also supported: `blender --background --python tools/art/build_assets.py`. The script uses only Blender's bundled Python; it requires no add-ons, pip installation, network access or GPU renderer. It intentionally overwrites the generated files. Studio lights, floor and cameras are excluded from the game exports. Source `.blend` projects and exported GLBs are tracked; Blender backup files are ignored.

## Runtime conventions

All coordinates below are **game/glTF meters**, with **+Y up and -Z forward**. Load the GLB scene directly without axis correction or unit scaling. The script converts coordinates for Blender and its glTF export restores the game convention.

| Asset | Size (X × Y × Z) | Meshes / material draw calls | Triangles |
| --- | --- | --- | --- |
| `public/assets/models/speeder.glb` | 6.051 × 1.691 × 7.915 m | 14 | 25,924 |
| `public/assets/models/atlas.glb` | 21.10 × 11.77 × 24.63 m (folded ramp, studio gear pose) | 53 | 36,396 |

The speeder origin is the center of its structural keel. Its lowest surface is Y=-0.46 m, so place it above the terrain by the desired hover height plus at least 0.46 m. ATLAS v2 uses the hangar floor as Y=0; its articulated feet extend below it. The manifest measures the exported rest pose, not every animated configuration. Runtime ground placement comes from `atlas-rig.ts`, including the complete body envelope, tilted foot soles and deployed ramp. These are visual meshes; flight continues to use the level's simplified rock colliders.

### Speeder attachments

| Node | Parent | Local position (X,Y,Z) | Use |
| --- | --- | --- | --- |
| `mining_turret` | `speeder` | (0, 0.80, 0.72) | Rotate around local Y for aiming; zero aims -Z. |
| `laser_socket` | `mining_turret` | (0, 0.28, -0.99) | Transform to world space for beam origin. Local -Z is the beam direction. |
| `exhaust_left` | `speeder` | (-2.37, 0, 3.62) | Exhaust origin; exhaust travels aft along +Z. |
| `exhaust_right` | `speeder` | (2.37, 0, 3.62) | Exhaust origin; exhaust travels aft along +Z. |
| `reverse_left/right` | `speeder` | (±2.37, -0.01, -3.20) | Front engine exhaust along -Z for braking/reverse. |
| `side_left_front/aft` | `speeder` | (-3.035, 0.04, ∓1.60) | Four modeled side nozzles; left exhaust along -X. |
| `side_right_front/aft` | `speeder` | (3.035, 0.04, ∓1.60) | Right exhaust along +X; opposing fore/aft pairs produce yaw. |
| `cargo_socket` | `speeder` | (0, 0.90, 2.02) | Collection effect destination. |

### ATLAS attachments

| Node | Local position (X,Y,Z) | Use |
| --- | --- | --- |
| `loading_socket` | (0, 0, 5), child of `ramp_section_3` | Moving end of the telescopic loading ramp. |
| `bay_socket` / `exit_socket` | (0, 1.35, 1) / (0, 1.35, 10) | Speeder parking position / exit direction along +Z. |
| `hangar_door` | (0, 0, 10.12) | Translates upward 5.1 m to clear the bay. |
| `ramp_hinge` | (0, 0, 10.4) | Rotates around X; four nested 5 m sections extend along +Z. |
| `hip_*`, `upper_*`, `knee_*`, `lower_*`, `piston_*`, `foot_*` | Root-local rig transforms | Four independent legs: `left_front`, `left_aft`, `right_front`, `right_aft`. Link meshes have unit length along +Y; soles use YXZ pitch/roll. |
| `lift_*` | (±6.65, -0.62, ±5.5) | Four downward landing jets. |
| `cruise_left/right`, `brake_left/right` | See manifest | Aft propulsion and forward braking exhaust. |
| `worklight_left/right` | (±4.4, 5.3, 10.4) | Portal light attachments. |

The ATLAS-specific authoring code is `tools/art/atlas_model.py`, invoked by the existing `art:models -- atlas` command. The bay has an actual floor, walls, ceiling and moving door, with no solid mesh across its interior. Deck crates sit outside the vehicle corridor. The four sections form a telescopic ramp; the local socket-parent map is included in the manifest. See [ATLAS-DEPLOYMENT.md](ATLAS-DEPLOYMENT.md) for runtime placement, animation and verification.

All meshes use glTF metallic/roughness materials with controlled emissive mint and amber surfaces. The assets do not require textures; panel breaks, small fasteners, vents and lettering are merged geometry. There are no transparency sorting or external image dependencies. Mesh/material names are descriptive; only the attachment names above are a runtime contract. The adjacent JSON manifests contain measured bounds and mesh statistics and are checked against Three.js loading by `validate_assets.mjs`.

## Verification

Both models were exported with Blender 5.2.1 and visually inspected through their Cycles previews. The Three.js validation loads each GLB, checks finite geometry and normals, compares exact bounds to its manifest, checks attachment names and validates independent turret rotation around the game's Y axis. Lighting in previews is a studio setup; in-game appearance depends on scene lighting, tone mapping and reflection environment.

## Original surface textures

`tools/generate-surfaces.py` produces the six 1024 × 1024 PNG source maps in `art/surfaces/`: sand and rock, each with base color, tangent-space normal and packed ORM (red occlusion, green roughness, blue metalness). The deterministic mathematical source uses seeded noise, sand ripples, strata and narrow fissures. These are original generated surfaces; no photographs, asset-store packs or CC0 textures were downloaded. The PNGs are editable source assets and are tracked alongside the generator.

`tools/encode-surfaces.mjs` converts those sources into the shipped maps in `public/assets/textures/`. The output uses **UASTC 4×4 in KTX2**, compression level 1, with a complete mip chain. Base colors use the color/sRGB path; normal and ORM data use the linear path. Three.js's `KTX2Loader` transcodes these files for the available GPU format using the local decoder in `public/assets/basis/`.

To rebuild, provide Python 3 with `numpy` and `Pillow` in your chosen Python environment, and a current Node.js version supported by Vite. No Python environment or package is installed automatically. First fetch the optional portable encoder from the official upstream source:

```powershell
./tools/fetch-art-tools.ps1
npm run art:surfaces
```

`art:surfaces` invokes `python` from PATH. If your environment uses a different Python command, run it explicitly followed by the encoder:

```sh
python tools/generate-surfaces.py
node tools/encode-surfaces.mjs
```

The encoder is a single-threaded WASI WebAssembly executable run by Node. It needs no native encoder or global system installation. Its download is pinned to [Basis Universal commit 1aab02ba2df16ad873229030ea191ea8c10e3fc9](https://github.com/BinomialLLC/basis_universal/commit/1aab02ba2df16ad873229030ea191ea8c10e3fc9), file `bin/basisu_st.wasm`, saved at `tmp/art-tools/basisu_st.wasm`. The fetch script verifies SHA-256 `7b8837e020e48239ab3085697a16334649c07ef121f5a6556d8b17919938a143`. The ignored `tmp/` cache is optional for development and is never required at runtime. On systems without PowerShell, download that same pinned file to the cache path and verify this hash before running the encoder.

Basis Universal is third-party compression software, separate from the original artwork. Its Apache 2.0 [license](../public/assets/basis/LICENSE) and [notice](../public/assets/basis/NOTICE) accompany the shipped runtime decoder. The decoder files themselves come from the project's Three.js 0.180.0 package.

## Procedural landscape geometry

Stratified cliff rings, irregular asteroid bodies and scattered rubble are generated by `src/landscape.ts`. `src/geology.ts` adds physical ridge slopes to Aster's shared heightfield: broad outer flanks taper into existing hills, with a steeper inner face toward each low canyon floor. Existing hills and the new ridges form a height union instead of stacking. Cliff tops retain their original datum, their bases extend below the new ground, and dust, flight and ore contacts follow the same terrain. Shelter floors remain flat.

`src/terrain-surface.ts` adds bent wind ripples on loose sand, warped weathering patches, localized fractured crust, mineral-soil color and muted bedrock texture on the ridge slopes. Fine surface grain remains shading detail. Cliff feet blend toward the surrounding soil palette, and the terrain casts shadows. Two instanced gravel variants and an additional skirt of partly buried scree cluster around slopes and outcrop feet, with reduced density in Standard quality. These decorative stones do not alter collision footprints.

`src/ore-outcrop.ts` generates three irregular mineral nests per deposit, interrupted branching veins, embedded host-rock chips and feathered mineral dust. Crystals use faceted prisms with dark roots. The mineral colors and emissive intensity decrease during extraction, while the host rock remains. Host geometry and weathering across the whole level merge into two shared draw calls; mineral instances remain separate for depletion and aiming. Labels sit above the visible clusters.

These surfaces are original procedural artwork, not Blender imports or downloaded rock packs. They reuse the compressed maps above without extra texture downloads. Large formations and ores use the same polygon footprints as collision and navigation at their interaction plane; distant debris and small instanced stones are visual detail. The full world is reproducible from its level definitions and seeds.

## Editable asteroids and shared basalt

Asteroids are level-owned density volumes in `src/sculpt.ts`. There is no asteroid GLB or Blender export pipeline. See [LEVEL-EDITOR.md](LEVEL-EDITOR.md).

The original material source is `surfaces/stone-fracture-source.png`, created with the built-in Imagegen tool. Its prompt and provenance are in [STONE-MATERIAL.md](STONE-MATERIAL.md). `tools/generate-stone.py` bakes deterministic 1024² colour, normal and packed occlusion/roughness/height maps from that source. Height and roughness are artistic estimates, not measured photogrammetry. `node tools/encode-stone.mjs` creates the three shared mipmapped KTX2 files. Host rock, fresh breaks and weathering use the same maps with locally painted blends. Vertex displacement and the shadow pass share the height function; tiny material relief does not change flight collision.
