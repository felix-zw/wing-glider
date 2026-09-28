# Wing Glider

A top-down 3D mining speeder with two selectable expeditions: the planet Aster and an asteroid belt. Built with Three.js, TypeScript and Vite, with original Blender vehicles, procedural landscapes, compressed PBR surfaces and a shared lighting/postprocessing pipeline. No backend or runtime asset service is required; models, textures and texture decoder ship with the application.

## Run

```sh
npm install
npm run dev
```

Use Node.js 20.19+ or 22.12+ as required by Vite 7; the current asset tools were verified on Node.js 24. Open the local URL printed by Vite. The loading screen reports model/texture progress before flight is enabled and offers a retry after a loading failure. `npm test` checks simulation and shelter reachability; `npm run build` runs TypeScript checks and creates `dist/`. `npm run preview` serves that build. Prebuilt artwork is checked in, so Blender and Python are only needed when rebuilding assets.

## Home Edge deployment

The production container builds and tests the current working tree with Node.js 24,
then serves only `dist/` through Nginx on port 80. It includes all models, compressed
textures and the local WASM decoder. Blender, development fixtures and source artwork
are not part of the deployed site. The web server runs as the `nginx` user with a
read-only filesystem and a temporary `/tmp` mount.

Home Edge must register `home-edge-wing-glider` as an internal, local bridge network
and connect its central `cloudflared` service to it. The edge overlay attaches only
this project's web service, with the alias `wing-glider-origin`. The existing
Cloudflare route is `wing-glider.felixzw.de` → `http://wing-glider-origin:80`, protected
by Cloudflare Access. Tunnel credentials stay in the infrastructure repository.

Deploy or update from PowerShell:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./infra/scripts/Start-WingGlider.ps1 -Edge
```

Omit `-Edge` for local Docker operation; add `-NoBuild` to reuse the existing image.
The wrapper validates the edge network and waits for a healthy container. The local
diagnostic endpoint is `http://127.0.0.1:18788/healthz`; only loopback is published.
`WING_GLIDER_PORT` can override the diagnostic port. This host's default Docker
address pool is exhausted, so the local ingress uses `10.243.89.0/24` and the centrally
managed edge network uses `10.243.90.0/24`.

```powershell
docker compose -f compose.yaml -f compose.edge.yaml ps
docker compose -f compose.yaml -f compose.edge.yaml logs --tail 50 web
```

The page and stable asset filenames are revalidated after deployments. Missing assets
return HTTP 404 instead of the application's HTML. Public checks without a Cloudflare
Access session should redirect to sign-in; the game itself requires an authenticated
browser session. Containers restart automatically when Docker starts.

## Controls

| Action | Keyboard / mouse | Standard gamepad |
| --- | --- | --- |
| Thrust | W / Up | Left stick up or right trigger |
| Turn | A, D / Left, Right | Left stick horizontal |
| Brake, then slowly reverse | S / Down / Space (hold) | Left stick down or left trigger (hold) |
| Aim turret | Mouse over the terrain | Right stick |
| Hold mining laser | X or either Shift key | Right bumper (RB) |
| Unload cargo | E (press once) | Y (press once) |
| Pause / resume | Escape or HUD button | HUD button with mouse |

The speeder coasts to a stop without input, in either direction. Braking takes priority over thrust: it first stops forward movement, then holding the same control drives backward at up to 6 m/s (22 km/h). Forward thrust stops reverse movement before accelerating forward. It turns in place and does not strafe. On Aster the hull pitches uphill/downhill and rolls with cross-slopes, sampling the whole footprint to maintain ground clearance. The turret keeps its world aiming direction despite the hull's inclination. Press a gamepad button to let the browser detect it; only standard-mapped controllers are supported. The HUD changes when a controller is detected.

On touch devices, two translucent sticks appear during play. Pull the **left stick** toward the desired on-screen flight direction; farther travel supplies more thrust. The speeder turns toward that direction before accelerating into it, so pulling the stick down points and flies south rather than engaging reverse. Hold the separate **Rückwärts** button to brake and then drive backwards along the current heading. It sits beside the left stick in landscape and above the right stick in portrait. The **right stick** aims and mines while displaced; releasing it stops the laser. Both sticks support independent fingers, analog travel and a centre dead zone. The **Entladen** button becomes available with cargo inside ATLAS's loading circle at low speed; the top **Pause** button opens the menu. Mobile HUD layouts reserve space for both thumbs and buttons, including safe-area insets. Releasing/cancelling a touch, pausing, rotating the device or switching away resets held inputs.

Touch controls hide when a supported gamepad is connected or the keyboard is used. Touching the screen again restores them when no gamepad is present. Browsers cannot reliably report whether a physical keyboard is attached, so keyboard use determines that handoff. Detection is based on touch capability/input rather than a phone user-agent list.

Open **Pause → Darstellung** to choose **Hoch** or **Standard**. High uses ambient occlusion, 2048-pixel shadows, full decorative detail and particle density, with display pixel ratio capped at 1.5. Standard disables screen-space ambient occlusion, uses 1024-pixel shadows, fewer decorative instances and particles, gentler bloom and pixel ratio capped at 1. Both preserve terrain, resources, hazards and protection information. The selection is remembered locally when browser storage is available.

Sound starts after the first pointer or keyboard interaction. A layered engine hum follows speed and thrust; the laser, rock breakage, pickup and unloading each have their own sound. Desert wind accompanies Aster and strengthens with its storms. **Pause → Lautstärke** controls volume and mute, remembered locally. Pausing, switching away from the tab or ending an expedition silences gameplay audio. All sounds are synthesized locally with Web Audio; no sound downloads or external service is needed.

## Two independent levels

Choose a destination on launch, or open **Pause → Level wählen**. Each destination starts a fresh expedition with its own cargo, deposits, contract and hazards. **Level neu starten** resets the current level. Progress is session-only; changing levels starts over. Level-specific render resources are disposed on switching while shared GLB geometry, materials and compressed textures remain cached for reuse.

**Aster** has six climbable hills and three canyons between tall, impassable rock ridges. Broad outer slopes join the exposed sandstone cliffs to the surrounding hills, while the canyon floors stay low. The speeder follows this continuous terrain automatically. Loose sand, weathered bedrock, patches of fractured crust and partly buried scree blend around the formations. Mineral-stained soil and broken host rock connect rooted ore clusters to hillsides and cliff faces. Cliffs block flight, lasers and fragment attraction. Collisions at speed damage the hull; approach and brake carefully. Shelter guidance routes around the cliffs through available passages.

**Asteroid belt** keeps the same arcade controls on a fixed flight plane. Nine large stationary asteroids carry ore veins. Twelve smaller moving asteroids can hit and damage the speeder; their movement appears on the radar. They bounce off large bodies and the ATLAS shield, and recycle outside the sector away from the player. The 22-meter shield around ATLAS protects against moving asteroids. There are no sandstorms or weather damage in space.

## Aster storm loop

45 seconds calm → 12 seconds warning → 15 seconds storm. Directional ground-level dust and changing light build the storm, with reduced dust inside the actual protected areas. The marked inner circles of nine depressions provide shelter. Stop there using the brake. Outside them, a storm deals 10 hull damage per second; hull does not regenerate. At zero hull, start a new expedition. Switching browser tabs pauses the simulation; resume explicitly when returning. Planetary dust and wake particles are absent from the asteroid belt.

## Mining and delivery

Aim at one of the labeled surface veins and hold X or Shift within 22 meters. The laser assists aim within 12 degrees, requires a clear line of sight, and targets the vein's surface. Ferrite takes 1 second per unit, copper ore 1.4 seconds, and crystals 1.8 seconds. Interrupted mining progress is retained. Mineral pieces recede and lose their color and glow as they are depleted; the surrounding host rock, weathering and landscape remain intact. They never regenerate during an expedition.

Released fragments visibly eject for 0.35 seconds, then are attracted within 10 meters and collected within 2 meters. The shared cargo hold carries 30 units. When full, fragments stay in the world and can be retrieved after unloading; mining remains available. Fragments do not expire.

Bring cargo to **ATLAS**, the transporter beside central shelter S5. Enter the gold loading circle (8 meters from its center), slow to at most 2 m/s (7.2 km/h), and press **E**. All cargo transfers to storage. The loading zone is protected from storms.

Each level's first contract requires **30 ferrite, 20 copper ore and 10 crystals delivered**. Mining or carrying them does not advance delivery goals. Completion is announced once; exploration, mining and surplus deliveries remain available afterward. Each map has 18 reproducible veins with 12 units each, six per resource, including all three types near the starting position. Restarting resets the entire expedition; nothing is saved across reloads.

Surface colors and materials distinguish metallic ferrite, rusty orange copper and pulsing cyan crystals. Their fragments retain distinct metal, cluster and crystal shapes. A thin mining beam, localized impact light and short-lived sparks show the active contact point; those decorative sparks never count as mined resources. Ore labels appear near the speeder or while targeted. The compact HUD separates delivered totals from onboard cargo, shows the current mining target and progress, and guides loaded players toward ATLAS. Shelter guidance takes priority during Aster's storm warnings and storms.

## Rendering and source artwork

The game keeps WebGL 2 and an elevated orthographic camera. The original twin-pod speeder and ATLAS cargo tender are exported from Blender as GLB, with shared materials and named laser, turret, exhaust, cargo and loading attachment points. Terrain and rocks remain deterministic procedural geometry: custom ring formations use authoritative level footprints, and the terrain shader blends sand and rock by slope and broad surface patterns. There are no downloaded rock packs or external CC0 texture assets. Original 1024-pixel sand/rock source maps are shipped as mipmapped UASTC 4×4 KTX2 textures.

`src/assets.ts` asynchronously loads and owns shared models/textures. `src/geology.ts` defines the physical ridge slopes shared by terrain, flight, ore placement and storm dust. `src/landscape.ts` builds embedded formations, instanced rubble, moving asteroid visuals, stars and shelter markers; `src/terrain-surface.ts` blends ground materials, wind ripples, weathering and mineral-soil transitions on the shared heightfield. `src/ore-outcrop.ts` builds embedded mineral clusters, branching fissures and their permanent host rock. `src/atmosphere.ts` handles wind-driven dust, shelter masking and vehicle wakes. `src/render-pipeline.ts` owns HDR rendering, ACES tone mapping, half-resolution GTAO, restrained bloom and SMAA. `src/world.ts` coordinates the camera, lighting, vehicle, quality setting and level lifecycle; `src/resource-world.ts` renders depletion, fragments, ATLAS and mining effects.

Editable Blender sources, actual model preview renders, attachment conventions and the complete reproduction instructions are in [art/ASSETS.md](art/ASSETS.md). The optional artwork workflow is:

```sh
npm run art:models
npm run art:validate
```

`art:models` uses `blender` on PATH or the `BLENDER` environment variable and requires Blender 5.2. To regenerate surface maps, provide Python 3 with NumPy/Pillow, fetch the pinned portable Basis Universal encoder with `./tools/fetch-art-tools.ps1`, then run `npm run art:surfaces`. That command runs `tools/generate-surfaces.py` and `tools/encode-surfaces.mjs`. The fetch script writes only to the ignored `tmp/art-tools/` cache and checks the upstream executable's SHA-256; it does not install a system tool. Source PNGs live in `art/surfaces/`, exported game maps in `public/assets/textures/`. The local decoder's [Apache license and attribution notice](public/assets/basis/README.md#wing-glider-distribution) are included with the game.

## Simulation architecture

`src/config.ts` holds shared tuning parameters. `src/levels.ts` defines destinations, terrain height and immutable structure/vein placements shared by physics, rendering and radar. `src/collision.ts` handles swept solid collisions and occlusion; `src/hazards.ts` advances space hazards; `src/navigation.ts` finds shelter routes. `src/simulation.ts` owns flight, weather and fixed-substep integration. `src/resources.ts` models veins, fragments, cargo, storage and resource events independently of Three.js. `src/missions.ts` defines event-based count objectives and nested all/any groups, with separate immutable definitions and per-expedition progress. Add a resource through its typed catalog; add contracts through mission definitions. New objective behaviors can extend the objective union and evaluator without changing mining logic.

`src/input.ts` maps devices to common actions, including one-shot unload presses. `src/main.ts` connects simulation, loading, HUD, quality preferences and application lifecycle. Static polygon footprints and surface anchors are shared by rendering, radar, navigation and collision. Moving asteroid and shield collisions keep their simple circle representation.

The world is 420 × 420 meters with a marked boundary. Decorative rocks are not collision obstacles. Shelter reachability is tested across a grid using a conservative turn–accelerate–brake pilot within the warning window. The vehicle stays above the same terrain height function used by the mesh.

## Validation and limits

Automated tests cover flight and weather, deterministic vein placement, surface access, collision and occlusion, moving hazards, shield safety, range/aim boundaries, mining delays and interruption, attraction, full cargo, delivery conditions, objective composition, reset/death, frame-rate comparison and per-resource conservation through both full expeditions. While the dev server is running, open `/tests/browser.html` and click **Run browser integration checks** for repeatable delivery scenarios in both levels using controlled positions with real keyboard controls, simulation and WebGL rendering. It also checks repeated level switching for stable GPU geometry/texture counts. This fixture is excluded from the production build.

`npm run art:validate` loads the actual GLBs with Three.js, checks geometry and draw-call budgets, confirms manifest bounds and validates named sockets and turret rotation. `/tests/visual.html` provides reproducible Aster, sheltered-storm, asteroid-mining, vehicle, cliff-ore, depleted-ore and asteroid-crystal views, selectable quality/resolution, and four 60-second performance scenarios with an optional warm-up and JSON export. Run that fixture in a visible browser tab on the target GPU; browser-reported GPU information may be masked. Both browser fixtures are development tools and are excluded from the production build.

The performance target is an average of at least **60 FPS at 1920 × 1080**, with **95% of frame times below 20 ms** in each representative scene. That target is an acceptance criterion, not a claimed benchmark result. Capture and inspect the visual/benchmark output on target hardware before declaring it met. A physical standard gamepad and native phone multitouch still need device testing. WebGL 2 is required; the UI reports renderer creation, asset-loading and context-loss failures. System fonts and local artwork keep the production app independent of external font/asset services. Combat and saved progress are outside this implementation.

The browser integration fixture also exercises simultaneous synthetic touch pointers, compass direction changes, a separately held reverse button, pointer ownership/cancellation, delivery and keyboard/gamepad handoff. `/tests/touch.html` loads the real game with emulated touch capability for desktop responsive previews; this development-only fixture is excluded from production. See [touch control verification](art/TOUCH-CONTROLS.md).

The [initial graphics verification report](art/VALIDATION.md) records the vehicle, asset and pipeline checks, followed by the [ground and ore refinement report](art/SURFACE-REFINEMENT.md). The [terrain integration report](art/TERRAIN-INTEGRATION.md) covers the continuous cliff slopes, comparison captures, CPU/GPU height checks and its performance results. The strict 60-FPS criterion remains unconfirmed in the Codex in-app browser; the visual fixture includes an independent RAF baseline and copyable JSON reports, preserving the original acceptance thresholds.

The subsequent [flight, audio and asteroid report](art/FLIGHT-AUDIO-ASTEROIDS.md) records reverse controls, hull clearance, shared turret/socket calculations, sound lifecycle checks and the fractured asteroid geometry. `src/vehicle-pose.ts` supplies the authoritative terrain attitude and hull clearance; `src/asteroid-rock.ts` builds asymmetrical rock shoulders and tapered volumes around the shared mining footprint. `src/audio.ts` owns the local sound graph and observes resource changes without altering the simulation. `/tests/audio.html` offers real Web Audio/offline signal checks and individual sound previews; the visual fixture includes uphill and side-slope presets.
