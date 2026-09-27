# Wing Glider

A top-down 3D speeder prototype on the planet Aster. Built with Three.js, TypeScript and Vite; no backend or external art assets required.

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
| Pause / resume | Escape or HUD button | HUD button with mouse |

The speeder coasts down without thrust. Braking takes priority over thrust. It turns in place, follows terrain height automatically and does not reverse or strafe. The turret keeps its world direction when aim input stops. Press a gamepad button to let the browser detect it; only standard-mapped controllers are supported. The HUD changes when a controller is detected. Touch controls are not included.

## Storm loop

45 seconds calm → 12 seconds warning → 15 seconds storm. The marked inner circles of nine depressions provide shelter. Stop there using the brake. Outside them, a storm deals 10 hull damage per second; hull does not regenerate. At zero hull, start a new expedition. Switching browser tabs pauses the simulation; resume explicitly when returning.

`src/simulation.ts` holds the tuning parameters, deterministic terrain height field, shelter placement, flight model and weather state machine. `src/input.ts` maps devices to common actions. `src/world.ts` renders terrain, vehicle, shelters and storm dust. `src/main.ts` connects the simulation, HUD and lifecycle.

The world is 420 × 420 meters with a marked boundary. Decorative rocks are not collision obstacles. Shelter reachability is tested across a grid using a conservative turn–accelerate–brake pilot within the warning window. The vehicle stays above the same terrain height function used by the mesh.

## Validation and limits

Automated tests cover motion, braking, independent aim, weather transitions, damage, shelter edges, death/reset, world boundaries, frame-rate comparison and shelter reachability. A physical standard gamepad and GPU/browser performance should also be checked on target hardware. WebGL 2 is required; the UI shows an explanatory message if renderer creation fails. Google Fonts is optional; system fonts remain available offline. No combat, sound, hovercraft, persistence or touch support is included yet.
