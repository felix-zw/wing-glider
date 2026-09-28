# Aster cliff and terrain integration — 2026-09-28

This pass connects the exposed cliffs to actual landforms, following the [ground and ore material refinement](SURFACE-REFINEMENT.md). Broad outer slopes replace the abrupt transition from narrow rock objects to surrounding ground. The application remains in Three.js with local, deterministic artwork.

## Visible and physical changes

- Each cliff rises from an asymmetric ridge: a broad outer backslope and a shorter inner slope toward the canyon floor. The landforms taper at their ends and join existing hills by taking their height union, avoiding artificially stacked peaks. The canyon passages remain low.
- Exposed cliff tops retain their original geological datum, with minimum clearance above the new ground. Their basal geometry extends below the terrain. Cliff-foot material blends toward the surrounding soil; the ground's bedrock palette follows the same ridge mask. Partly buried, flattened scree bridges the final contact edge.
- The terrain now casts shadows. Fine sand ripples, weathered surfaces, permanent ore host rock and the existing foreground-cliff cutaway are retained.
- The physical heightfield is shared by the rendered mesh, vehicle hover height, mouse aiming and ore placement. Wall ore and its interaction points follow the local floor along the whole deposit. The storm shader uses the matching ridge function so airborne dust follows the new slopes.
- Shelter floors remain flat and protected. The asteroid flight plane and formations are unchanged. Decorative scree uses a single instanced mesh and reduced density in Standard quality.

## Verification

- `npm test`: **43 passed, 0 failed**, including shelter reachability, both complete resource expeditions, continuous ridge joins, protected floors, space height and wall interaction clearance.
- `npm run build`: TypeScript and production build passed. The existing Three.js vendor-chunk size advisory remains.
- Browser integration passed both expeditions, mining/delivery, keyboard and simulated gamepad controls, collision, restart, loading cancellation and sixteen level/quality transitions. GPU geometry/texture counts stayed stable for matching states. Terrain aiming averaged **0.13 ms/sample**.
- An actual GPU readback compares the storm ridge shader to the CPU height calculation at **240 points** around cliff faces, backslope edges and ridge ends. Maximum error: **0.000002 m**.
- Visual review covered High/Standard ridge views, the matching Aster overview, protected storm and cliff mining. The production build loaded its local assets, rendered the normal HUD and paused successfully. No production console errors or warnings were recorded; an earlier development-session KTX2 loader warning remains in the tab's historical log.

[Full browser checks](../screenshots/terrain-integration/browser-checks.txt).

## Performance

Visible Codex in-app browser, Chromium 154 / ANGLE D3D11, browser-reported NVIDIA GeForce RTX 5060 Ti. The adapter identity was not independently verified. High quality, actual **1920 × 1080** drawing buffer, 3-second warm-up and 60 measured seconds per workload. Draw counts include all rendering passes, including terrain shadows.

| Scene | Mean FPS | p95 frame time | Longest frame | Mean draws |
| --- | ---: | ---: | ---: | ---: |
| Calm flight | 59.9991 | 16.80 ms | 16.80 ms | 328 |
| Aster mining | 59.9991 | 16.80 ms | 16.90 ms | 289 |
| Sheltered storm | 59.9990 | 16.80 ms | 16.90 ms | 312 |
| Belt mining | 59.9992 | 16.80 ms | 16.80 ms | 214 |

Fresh ten-second baselines without simulation or WebGL rendering measured **59.9988 FPS with DOM updates** and **60.0000 FPS without DOM updates**, both at p95 16.80 ms. This session runs at approximately 60 Hz, unlike the earlier report's approximately 56.6 Hz baseline; that difference must not be attributed to a rendering speedup. No additional frame-time spikes appear in these workloads.

**The strict ≥60 average FPS / p95 <20 ms acceptance criterion is still not marked as passed.** Raw averages remain fractionally below 60; all four p95 results pass. The UI rounds the displayed averages to 60.0 but preserves `meetsFrameTarget: false`. No thresholds or measurements were adjusted.

[Combined raw JSON](../screenshots/terrain-integration/benchmark-high-1080p.json) · [Readable report](../screenshots/terrain-integration/benchmark-high-1080p.txt).

## Actual browser captures

These are captures of the implementation, not mockups. The visual fixture rendered at 1920 × 1080, captured in its 1280 × 720 CSS viewport; JPEG files preserve browser screenshot bytes without editing. The new **Aster · Felsrücken** preset makes the terrain connection easy to revisit.

- [Current Aster overview](../screenshots/terrain-integration/aster-calm.jpg), compared with the [previous matching view](../screenshots/surface-review/aster-calm.jpg)
- [Ridge and canyon, High](../screenshots/terrain-integration/aster-ridge.jpg)
- [Ridge and canyon, Standard](../screenshots/terrain-integration/aster-ridge-standard.jpg)
- [Cliff mining and foreground cutaway](../screenshots/terrain-integration/aster-cliff.jpg)
- [Sheltered storm](../screenshots/terrain-integration/aster-storm.jpg)
- [Production gameplay with HUD](../screenshots/terrain-integration/aster-production.jpg)
