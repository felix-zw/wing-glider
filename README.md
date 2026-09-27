# Wing Glider

A top-down 3D mining speeder with two selectable expeditions: the planet Aster and an asteroid belt. Built with Three.js, TypeScript and Vite; no backend or external art assets required.

## Run

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. `npm test` checks simulation and shelter reachability; `npm run build` runs TypeScript checks and creates `dist/`. `npm run preview` serves that build.

## Controls

| Action | Keyboard / mouse | Standard gamepad |
| --- | --- | --- |
| Thrust | W / Up | Right trigger |
| Turn | A, D / Left, Right | Left stick horizontal |
| Brake | Space | Left trigger |
| Aim turret | Mouse over the terrain | Right stick |
| Hold mining laser | X or either Shift key | Right bumper (RB) |
| Unload cargo | E (press once) | Y (press once) |
| Pause / resume | Escape or HUD button | HUD button with mouse |

The speeder coasts down without thrust. Braking takes priority over thrust. It turns in place, follows terrain height automatically and does not reverse or strafe. The turret keeps its world direction when aim input stops. Press a gamepad button to let the browser detect it; only standard-mapped controllers are supported. The HUD changes when a controller is detected. Touch controls are not included.

## Two independent levels

Choose a destination on launch, or open **Pause → Level wählen**. Each destination starts a fresh expedition with its own cargo, deposits, contract and hazards. **Level neu starten** resets the current level. Progress is session-only; changing levels starts over. Old level geometries, materials and textures are disposed on switching.

**Aster** has six climbable hills and three canyons between tall, impassable rock ridges. The speeder follows the hills automatically. Glowing ore veins conform to hillsides and cliff faces. Cliffs block flight, lasers and fragment attraction. Collisions at speed damage the hull; approach and brake carefully. Shelter guidance routes around the cliffs through available passages.

**Asteroid belt** keeps the same arcade controls on a fixed flight plane. Nine large stationary asteroids carry ore veins. Twelve smaller moving asteroids can hit and damage the speeder; their movement appears on the radar. They bounce off large bodies and the ATLAS shield, and recycle outside the sector away from the player. The 22-meter shield around ATLAS protects against moving asteroids. There are no sandstorms or weather damage in space.

## Aster storm loop

45 seconds calm → 12 seconds warning → 15 seconds storm. The marked inner circles of nine depressions provide shelter. Stop there using the brake. Outside them, a storm deals 10 hull damage per second; hull does not regenerate. At zero hull, start a new expedition. Switching browser tabs pauses the simulation; resume explicitly when returning.

## Mining and delivery

Aim at one of the labeled surface veins and hold X or Shift within 22 meters. The laser assists aim within 12 degrees, requires a clear line of sight, and targets the vein's surface. Ferrite takes 1 second per unit, copper ore 1.4 seconds, and crystals 1.8 seconds. Interrupted mining progress is retained. Veins lose their color and glow as they are depleted; the host landscape remains intact. They never regenerate during an expedition.

Released fragments visibly eject for 0.35 seconds, then are attracted within 10 meters and collected within 2 meters. The shared cargo hold carries 30 units. When full, fragments stay in the world and can be retrieved after unloading; mining remains available. Fragments do not expire.

Bring cargo to **ATLAS**, the transporter beside central shelter S5. Enter the gold loading circle (8 meters from its center), slow to at most 2 m/s (7.2 km/h), and press **E**. All cargo transfers to storage. The loading zone is protected from storms.

Each level's first contract requires **30 ferrite, 20 copper ore and 10 crystals delivered**. Mining or carrying them does not advance delivery goals. Completion is announced once; exploration, mining and surplus deliveries remain available afterward. Each map has 18 reproducible veins with 12 units each, six per resource, including all three types near the starting position. Restarting resets the entire expedition; nothing is saved across reloads.

Surface colors and materials distinguish metallic ferrite, rusty orange copper and pulsing cyan crystals. Their fragments retain distinct metal, cluster and crystal shapes. The HUD separates delivered totals from onboard cargo, shows the current mining target and progress, and guides loaded players toward ATLAS. Shelter guidance takes priority during Aster's storm warnings and storms.

`src/config.ts` holds shared tuning parameters. `src/levels.ts` defines destinations, terrain height and immutable structure/vein placements shared by physics, rendering and radar. `src/collision.ts` handles swept solid collisions and occlusion; `src/hazards.ts` advances space hazards; `src/navigation.ts` finds shelter routes. `src/simulation.ts` owns flight, weather and fixed-substep integration. `src/resources.ts` models veins, fragments, cargo, storage and resource events independently of Three.js. `src/missions.ts` defines event-based count objectives and nested all/any groups, with separate immutable definitions and per-expedition progress. Add a resource through its typed catalog; add contracts through mission definitions. New objective behaviors can extend the objective union and evaluator without changing mining logic.

`src/input.ts` maps devices to common actions, including one-shot unload presses. `src/world.ts` renders terrain and flight; `src/resource-world.ts` renders procedural resources, instanced fragments, transporter and laser effects. `src/main.ts` connects simulation, HUD and lifecycle.

The world is 420 × 420 meters with a marked boundary. Decorative rocks are not collision obstacles. Shelter reachability is tested across a grid using a conservative turn–accelerate–brake pilot within the warning window. The vehicle stays above the same terrain height function used by the mesh.

## Validation and limits

Automated tests cover flight and weather, deterministic vein placement, surface access, collision and occlusion, moving hazards, shield safety, range/aim boundaries, mining delays and interruption, attraction, full cargo, delivery conditions, objective composition, reset/death, frame-rate comparison and per-resource conservation through both full expeditions. While the dev server is running, open `/tests/browser.html` and click **Run browser integration checks** for repeatable delivery scenarios in both levels using controlled positions with real keyboard controls, simulation and WebGL rendering. It also checks repeated level switching for stable GPU geometry/texture counts. This fixture is excluded from the production build.

A physical standard gamepad and GPU/browser performance should also be checked on target hardware. WebGL 2 is required; the UI shows an explanatory message if renderer creation fails. Google Fonts is optional; system fonts remain available offline. No combat, sound, hovercraft, persistence or touch support is included yet.
