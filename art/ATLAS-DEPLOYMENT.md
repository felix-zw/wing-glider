# ATLAS landing and deployment

ATLAS is an ivory/orange expedition tender with a hollow vehicle hangar, sliding overhead door, four-section telescopic ramp, four independently articulated landing legs and modeled lift/cruise/braking nozzles. The unchanged 6.05 m wide speeder fits through the 8.1 m doorway.

Every new expedition and restart plays an eight-second sequence without a skip control. On planets the ship descends on lift jets, extends its feet, makes individual ground contacts and settles. The door opens at 2.5 seconds; the ramp follows, then the speeder automatically leaves between seconds 4 and 8. In space the ship brakes into position with its legs folded and deploys the speeder with 4 m/s forward velocity. On planets the speeder stops outside the ramp. ATLAS remains as an open base; the authored loading circle, delivery speed limit and protection rules remain in use.

## State and integration

- `createState(id, {arrival:true})` is used by production expedition starts. The default constructor remains immediately playable for existing simulation and editor fixtures. `State.deployment` retains the absolute sequence clock and phase; gameplay time starts after the handoff.
- `deployment.ts` supplies one deterministic frame for the player, camera, rig, effects and procedural audio. Inputs, mining, unloading, hazards, health and mission progress are inactive during deployment. Pause/visibility changes freeze the clock. There are no independent animation timers or delayed audio events to replay after resuming.
- `atlas-rig.ts` searches reproducible positions/orientations around the authored base without relocating the service circle. It checks terrain, full body clearance, bounded telescopic leg reach, wide ramp clearance, rock footprints and level bounds. Feet sample their rotated sole footprint. The body stays level while knees, lower legs and foot plates compensate for terrain.
- `AtlasWorld` owns the per-level transforms and bounded dust/light/exhaust effects. GLB geometry/materials stay shared through `AssetLibrary`; effects and label textures follow the existing level disposal lifecycle. Standard quality reduces dust count and disables the local effect light.
- The level editor reports a blocking ATLAS-placement issue for a base with insufficient clear terrain. Decorative rubble avoids the body, feet and exit corridor. Existing document files require no schema migration. Actual expedition departure is now at ATLAS; the authored spawn remains available to direct simulation/editor fixtures.

## Reproduction and checks

Rebuild only ATLAS with `npm run art:models -- atlas` (set `BLENDER` if needed), then run `npm run art:validate`, `npm test` and `npm run build`.

`/tests/atlas.html` provides planet/space playback, exact-time poses, High/Standard selection, a side inspection camera and geometry/lifecycle checks. The checks inspect every vertex of the real ATLAS and speeder GLBs across deployment phases: terrain/ramp clearance, hangar-wall/ceiling clearance, raised door clearance, frozen pause state, audio gating, zero gameplay cost and stable GPU resource counts after repeated switches. `/tests/browser.html` and `/tests/audio.html` retain the broader gameplay/input and audio regressions.

Unit coverage includes independent foot contacts on compound slopes, unreachable rig configurations, supported exit paths, endpoint pose/velocity, ignored deployment inputs, zero-time pause, restarts, custom base placement and matching handoff states at 30/144 FPS. Browser timings are environment-dependent; passing geometry checks does not itself establish a 60 FPS hardware target.

Verified on 2026-09-29: 92 unit/simulation tests, 284 ATLAS browser checks, 136 existing gameplay/browser checks and 33 audio checks passed. Build and model validation passed; Vite retains the existing large-chunk advisory. The corrected space approach corridor and level-editor validation were also retested. Production arrival, pause/resume and a stationary full-health handoff were inspected at 390×844, and the compact sequence overlay at 568×320.

Actual rendered captures and check logs are in `screenshots/atlas-deployment/`: [planet exit](../screenshots/atlas-deployment/aster-exit.png), [space exit](../screenshots/atlas-deployment/belt-exit.png), [mobile arrival](../screenshots/atlas-deployment/mobile-arrival.png), [ATLAS checks](../screenshots/atlas-deployment/checks.txt), [gameplay checks](../screenshots/atlas-deployment/browser-checks.txt) and [audio checks](../screenshots/atlas-deployment/audio-checks.txt).
