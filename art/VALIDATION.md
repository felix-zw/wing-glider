# Graphics implementation verification — 2026-09-27

This report covers the initial graphics implementation. The subsequent [ground and ore refinement](SURFACE-REFINEMENT.md) has its own current screenshots and repeated performance/functional checks. The measurements below describe the earlier rendering revision.

The application remains a Three.js/WebGL 2 game. This implementation includes original Blender vehicles, local compressed PBR maps, shared polygon collision/ore surfaces, detailed formations, terrain-following dust, mining effects, HDR postprocessing, and the revised HUD. The mockups in `output/mockups` are visual references; the captures below show the actual implementation.

## Functional and asset checks

- `npm test`: **40 passed, 0 failed**, including complete extraction/delivery of all resources in both expeditions, collision facets, route clearance and shelter reachability.
- `npm run build`: TypeScript and production bundle succeeded.
- Production smoke check via `npm run preview`: both destinations rendered their shipped GLB/KTX2 assets, and switching from Aster to the asteroid belt succeeded. The HUD gameplay captures below come from this production build.
- `npm run art:validate`: both real GLBs load through Three.js; bounds, sockets and independent turret rotation verified. Speeder: 14 meshes, 23,668 triangles. ATLAS: 10 meshes, 23,424 triangles.
- Browser integration: both missions, keyboard input, simulated standard gamepad input, collisions, pause/reset, and sixteen level/quality transitions passed. GPU geometry/texture counts remained stable for repeated matching states. Terrain aiming averaged **0.05 ms per sample** in this fixture.
- Disposing a World while KTX2 decoding was active settled its loading promise, removed its canvas, released late textures and tolerated a second disposal. The intentional two-World test emits Three.js's warning about multiple simultaneous KTX2 loaders; ordinary gameplay uses one library.
- Quality selection survived reload. Desktop (1280 × 720 CSS viewport) and narrow (390 × 844) HUD layouts were visually checked. No touch controls are provided; a physical gamepad was not tested.

[Full browser check output](../screenshots/review/browser-checks.txt).

## Final performance measurement

Visible Codex in-app browser, Chromium 154 user agent, ANGLE/D3D11. Browser-reported adapter: NVIDIA GeForce RTX 5060 Ti. High quality, **actual 1920 × 1080 drawing buffer**, 3 seconds warm-up followed by 60 measured seconds per scene. The fixture advances real simulation and renders the world; it uses a diagnostic panel instead of the main game HUD. Draw and triangle counts include all renderer passes.

| Scene | Mean FPS | p95 frame time | Longest frame | Mean draws |
| --- | ---: | ---: | ---: | ---: |
| Calm flight | 56.62 | 18.10 ms | 18.70 ms | 308 |
| Aster mining | 56.62 | 18.10 ms | 18.70 ms | 270 |
| Sheltered storm | 56.64 | 18.10 ms | 18.70 ms | 294 |
| Belt mining | 56.65 | 18.10 ms | 18.60 ms | 209 |

**The strict ≥60 average FPS / p95 <20 ms acceptance criterion is not met by this browser run.** The p95 requirement passes in all scenes. Separate ten-second RAF measurements with rendering and simulation stopped yielded 56.61 FPS with DOM updates and 56.72 FPS without them, both with p95 18.10 ms. This supports a browser/compositor pacing limit rather than scene-dependent dropped frames in this environment; it is not a substitute for a 60-FPS result in a standalone target browser. No values were normalized or reclassified as PASS.

[Raw combined JSON](../screenshots/review/benchmark-high-1080p.json) · [Readable scene report](../screenshots/review/benchmark-high-1080p.txt) · [Independent baseline](../screenshots/review/scheduler-baseline.json).

To repeat, run `npm run dev`, open `/tests/visual.html` in a visible browser, select Hoch and 1920 × 1080, and start the four-scene measurement. Keep the tab visible; changing tabs aborts measurement. The separate RAF baseline stops simulation/rendering. Use “JSON anzeigen” to copy both reports or “JSON speichern” to download the scene report. Reports survive same-tab reloads through session storage. Neither fixture ships in the production bundle.

## Actual browser captures

- [Aster with HUD](../screenshots/review/aster-gameplay.png)
- [Asteroid belt with HUD](../screenshots/review/belt-gameplay.png)
- [Aster mining, fixed state](../screenshots/review/aster-calm.png)
- [Sheltered sandstorm](../screenshots/review/aster-storm.png)
- [Asteroid mining, fixed state](../screenshots/review/belt-mining.png)
- [Speeder close-up](../screenshots/review/vehicle-closeup.png)
- [Narrow-window HUD](../screenshots/review/responsive-390.png)

Editable models and reproducible artwork instructions are in [ASSETS.md](ASSETS.md).
