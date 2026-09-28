# Drift, inertial space flight and thrusters

Implemented and checked on 2026-09-28. This supersedes the older directional-touch and hold-to-reverse mappings in the historical touch/audio reports.

## Behavior

- Aster uses relative steering, independent gas and normal brake, and a held handbrake. Reduced lateral grip lets the rear slide; releasing it recovers grip over 0.4 seconds. Drift adds drag and provides no boost.
- Space preserves world velocity while the hull turns. Lateral assistance gently corrects the course. Holding free glide immediately disables that assistance; releasing it restores assistance gradually. Gas and the normal brake remain available during free glide.
- The normal brake slows the complete velocity vector and holds at rest. Release after stopping, then press and hold again for slow reverse. Gas brakes reverse motion before accelerating forward. Pause, cancellation and device changes clear reverse arming.
- Velocity is authoritative as `vx/vz`; total speed and longitudinal speed are derived separately. Unloading checks total speed, including sideways motion. Static impacts remove inward velocity while preserving tangential travel; moving hazards use relative world velocity.
- Front engine sockets provide reverse/braking exhaust. Four modeled side nozzles provide translation and opposing yaw jets. Exhaust and engine sound follow active forces; passive coasting alone creates no flame. Ground reverse thrust compensates drag, including at the 6 m/s cruising cap.
- Planetary dust follows the actual trajectory and spreads during drift. Terrain attitude, clearance and independent turret aiming remain intact.

## Controls

| Action | Keyboard | Standard gamepad | Touch |
| --- | --- | --- | --- |
| Gas | W / Up | RT | Hold Gas; double tap to latch |
| Relative steering | A/D, Left/Right | Left stick horizontal | Left stick horizontal |
| Normal brake / reverse | S / Down | LT | Bremse / R |
| Drift / free glide | Space | A | Drift / Gleiten |
| Aim / mine | Mouse + X or Shift | Right stick + RB | Displace right stick |
| Unload | E | Y | Entladen |

Latched touch gas is visibly marked **GAS FIX**. Another gas tap or the normal brake cancels it; the handbrake preserves it. Pause, touch cancellation, resize, blur and device handoff clear the latch. Buttons have 56×52 CSS-pixel hit areas; sticks retain independent pointer ownership and capture. Responsive layouts were inspected at 390×844, 320×568 and 568×320. The pause menu explains the controls.

## Tuning

| Parameter | Aster | Space |
| --- | --- | --- |
| Forward acceleration | 17 m/s² before drag | 12 m/s² |
| Passive drag | 3.2 m/s² | 0.03/s |
| Lateral damping | 8/s normal, 1.8/s drift | 0.65/s, correction capped at 8 m/s² |
| Maximum turn rate | 1.9 rad/s normal, 2.4 rad/s drift | 1.9 rad/s |
| Drift drag | additional 1.5 m/s² | none |
| Powered speed caps | 38 m/s forward, 6 m/s reverse | same; rotating the hull does not clamp reverse-projected inertia to 6 m/s |

Motion lives in `src/flight-motion.ts`, integrated with simulation substeps of at most 1/120 second. Steering rate approaches its target smoothly. Tuning can be adjusted without changing renderer or input code.

## Verification

- **74/74 unit/simulation tests**: brake press transitions, analog motion, drift slip/recovery, space trajectory/assist, reverse steering and continuous front thrust, force-to-nozzle mapping, lateral unloading rejection, wall sliding, 30/144 FPS agreement, the full existing resource/hazard/weather suite and shelter reachability within the warning window.
- **136/136 browser checks**: synthetic simultaneous touch pointers, gas latch/cancellation, keyboard and gamepad mappings, device handoff, actual imported front/side flame visibility, both complete delivery loops, terrain GPU parity and repeated level/quality switches with stable geometry/texture counts.
- **33/33 audio checks**: actual Web Audio lifecycle, force-sensitive engine hum, all six offline previews, no clipping and silent tails.
- `npm run build`: passed. Vite still reports the existing large Three.js vendor chunk.
- `npm run art:validate`: passed. Speeder: 14 meshes, 25,924 triangles, 640 KiB, all attachment nodes verified. Updated Blender source, GLB, manifest and studio preview are included.
- Browser hull-clearance sampling of the actual exported mesh remained positive: minimum **1.16 m** across the fixture's slope/crest placements.

Logs: [browser](../screenshots/drift-space/browser-checks.txt), [audio](../screenshots/drift-space/audio-checks.txt).

## Focused performance check

The visual fixture adds a reproducible **2 × 15 s Drift und Weltraum messen** action and four maneuver stills. The existing four 60-second scene measurements remain available.

High quality, actual 1920×1080 drawing buffer, 3-second warm-up per scene, Codex in-app browser:

| Workload | Average FPS | p95 frame time | Mean draw calls |
| --- | ---: | ---: | ---: |
| Aster drift | 56.61 | 18.10 ms | 225.21 |
| Space correction / glide | 56.67 | 18.10 ms | 194.71 |
| RAF + status updates, no simulation/rendering | 56.65 | 18.10 ms | — |
| RAF only, no simulation/rendering | 56.72 | 18.10 ms | — |

The almost identical rendering and no-render timing suggests a browser/compositor cadence limit in this run. This is an inference, not proof of performance on other devices. The strict **60 FPS average / p95 below 20 ms** target remains unconfirmed; the report correctly marks both average-FPS checks below target. These short maneuver samples do not replace the full scene benchmarks or testing on physical phones and gamepads. The browser reported an NVIDIA RTX 5060 Ti; the physical adapter was not independently verified.

[Raw performance and scheduler report](../screenshots/drift-space/performance.json).

## Captures

- [Aster drift and side jets](../screenshots/drift-space/aster-drift.jpg)
- [Front exhaust while reversing](../screenshots/drift-space/reverse.jpg)
- [Space lateral correction](../screenshots/drift-space/space-correction.jpg)
- [Portrait touch controls](../screenshots/drift-space/touch-portrait.jpg)
- [Small portrait](../screenshots/drift-space/touch-small-portrait.jpg)
- [Small landscape](../screenshots/drift-space/touch-landscape.jpg)

These are actual Three.js screenshots, not concept art.
