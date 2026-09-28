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
| `public/assets/models/atlas.glb` | 10.65 × 6.37 × 20.43 m | 10 | 23,424 |

The speeder origin is the center of its structural keel. Its lowest surface is Y=-0.46 m, so place it above the terrain by the desired hover height plus at least 0.46 m. ATLAS has ground-level origin and its lowest foot pad is Y=0.03 m. ATLAS bounds include its deployed aft ramp, service platform and ground cargo case. These are visual meshes; gameplay should use the level's simplified collider rather than all triangles.

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
| `loading_socket` | (0, 0.22, 11.30) | Ground end of the aft loading ramp. |
| `worklight_left` | (-4.14, 4.88, 4.67) | Optional downward-facing task light. |
| `worklight_right` | (4.14, 4.88, 4.67) | Optional downward-facing task light. |

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

Asteroids now use `src/asteroid-rock.ts`: irregular triangulated shoulders, off-center depressions, tapered upper/lower outlines and 19–24 partly embedded angular crag blocks per body. The blocks are merged into each body's mesh. A dark, mostly matte stone shader adds broad mineral variation and fine interrupted angular fissures. There are no latitude rings. The exact polygon is preserved through the -1 to 7.4 m interaction band, keeping ores and collision aligned. Contact raycasts, closed surfaces, containment and the original 10,000-triangle limit are tested for every large asteroid.

`src/vehicle-pose.ts` uses the speeder's full underside envelope for terrain clearance. Its projected turret basis and GLB pivot/socket coordinates preserve the aiming bearing while the hull tilts. The 4.5 m collision radius covers the real asset's measured 4.437 m maximum horizontal hull radius. Local audio is procedural Web Audio in `src/audio.ts`; there are no additional audio files, codecs or licensing dependencies. See [FLIGHT-AUDIO-ASTEROIDS.md](FLIGHT-AUDIO-ASTEROIDS.md) for current verification.

Visual review and target-hardware measurement use `/tests/visual.html` on the Vite development server. The fixture provides fixed Aster, ridge/canyon, storm, asteroid-mining, vehicle, cliff-ore, depleted-ore and asteroid-crystal views plus timed performance runs. The latest captures and measured results are in [TERRAIN-INTEGRATION.md](TERRAIN-INTEGRATION.md). Studio renders and passing builds do not prove the target of 60 FPS at 1080p; that target must be assessed with the browser/GPU benchmark results.
