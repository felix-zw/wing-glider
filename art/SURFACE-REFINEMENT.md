# Aster ground and embedded ore refinement — 2026-09-27

This follow-up refines the ground and ore integration after the [initial graphics implementation](VALIDATION.md). The cliff and asteroid formation geometry, vehicles, authoritative heightfield, collision footprints and simulation rules are preserved.

## Visible changes

- Aster ground now blends loose sand, weathered slopes, locally fractured crust and stony outcrop feet. Broad warped variation replaces the uniformly repeating ridge pattern. Wind ripples have shallow relief, vary with sand coverage and fade below pixel resolution. The cliff texture's crossing strata/fissures are muted on eroded ground.
- Two instanced gravel variants add low, partly buried chips concentrated near slopes, rock feet and mineral sites. Protected shelter floors retain fine sand. Standard quality reduces decorative instances while preserving the material transitions.
- Ground ore influences the terrain material itself, including warmer copper weathering. Permanent broken host rock and feathered mineral dust surround three irregular nests of rooted mineral pieces. Branching, interrupted fissures connect the nests. Wall and asteroid outcrops use the same rock palette/maps as their host.
- Crystals use short faceted prisms and darker roots. Extracted mineral pieces recede and darken; the surrounding rock remains. A newly loaded depleted state renders correctly on its first frame. Labels are raised so they do not cover the smaller embedded clusters.
- All artwork remains local and deterministic. No new downloads, engine, texture package or external asset dependency was introduced. The added host rock/weathering is merged across each level into two meshes.

## Verification

- `npm test`: **40 passed, 0 failed**, including full resource conservation and delivery in both levels, collision and shelter reachability.
- `npm run build`: TypeScript and production build passed. Vite retains its existing advisory about the Three.js vendor chunk exceeding 500 kB.
- Browser integration: both expeditions, mining/delivery, keyboard and simulated gamepad controls, pause/reset, collisions, disposal during asset loading and sixteen level/quality transitions passed. GPU geometry/texture counts remained stable for matching states. Mouse aiming averaged **0.07 ms/sample** in this fixture.
- Fixed-state review covered ground ores, cliff ores, asteroid crystals, depleted deposits and High/Standard terrain. Aster's existing foreground-cliff cutaway remains visible in the cliff screenshot. New review presets are available in `/tests/visual.html`.
- Production preview: the built Aster level loaded its local assets, rendered the new ground/ores with the normal HUD and paused through the existing controls. No browser console errors were reported. The preview was left paused for review.

[Full browser results](../screenshots/surface-review/browser-checks.txt).

## Current performance run

Visible Codex in-app browser, Chromium 154 / ANGLE D3D11; browser-reported NVIDIA GeForce RTX 5060 Ti (hardware identity not independently verified). High quality, actual **1920 × 1080** drawing buffer, 3 seconds warm-up and 60 measured seconds per workload. Draw/triangle counts include all renderer passes. These results were measured after the surface and ore changes above.

| Scene | Mean FPS | p95 frame time | Longest frame | Mean draws |
| --- | ---: | ---: | ---: | ---: |
| Calm flight | 56.59 | 18.10 ms | 18.70 ms | 321 |
| Aster mining | 56.59 | 18.10 ms | 18.70 ms | 284 |
| Sheltered storm | 56.65 | 18.10 ms | 18.60 ms | 308 |
| Belt mining | 56.60 | 18.10 ms | 18.70 ms | 214 |

The fresh ten-second RAF baselines measured **56.61 FPS with DOM updates** and **56.59 FPS without DOM updates**, both at p95 18.10 ms with simulation and rendering disabled. Frame pacing remains comparable to the initial implementation and to the browser-only baseline. This run shows no additional frame-time spikes from the added surfaces at these settings; it does not establish GPU headroom on other hardware.

**The strict ≥60 average FPS / p95 <20 ms criterion remains unmet in this browser.** The p95 requirement passes in all four scenes. The independent baseline supports a browser/compositor pacing limit, but cannot substitute for validation in a standalone target browser. No measurement was normalized or marked PASS against the 60-FPS target.

[Raw combined JSON](../screenshots/surface-review/benchmark-high-1080p.json) · [Readable report](../screenshots/surface-review/benchmark-high-1080p.txt).

## Actual browser captures

The images below are browser captures of the implementation, not concept images. The drawing buffer was 1920 × 1080; screenshots show the 1280 × 720 CSS viewport. JPEG files preserve the browser capture bytes without image editing.

- [Aster overview, High](../screenshots/surface-review/aster-calm.jpg)
- [Production gameplay with HUD](../screenshots/surface-review/aster-production.jpg)
- [Aster and ore close-up](../screenshots/surface-review/aster-closeup.jpg), compared with the [previous matching view](../screenshots/review/vehicle-closeup.png)
- [Aster overview, Standard](../screenshots/surface-review/aster-standard.jpg)
- [Cliff ore and existing foreground cutaway](../screenshots/surface-review/aster-cliff.jpg)
- [Permanent host rock after depletion](../screenshots/surface-review/aster-depleted.jpg)
- [Asteroid crystal outcrop](../screenshots/surface-review/belt-crystal-outcrop.jpg)
