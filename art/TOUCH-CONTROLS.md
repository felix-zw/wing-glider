# Touch control verification — 2026-09-28

The game now supports translucent twin sticks in both expeditions. The left stick
selects an absolute on-screen flight direction and analog thrust. The speeder
turns toward that direction before accelerating into it. Pulling down points the
ship south; it never selects reverse. A separate held reverse button brakes and
then drives backwards along the ship heading. It sits beside the left stick in
landscape and above the right stick in portrait. Right-stick travel aims and mines;
release stops the laser. The separate delivery button is enabled only with cargo,
in ATLAS's loading zone, below the speed limit.
The existing pause menu remains accessible through a 44-pixel-high button.

`src/touch-controls.ts` owns independent pointer IDs/capture for both sticks and
the reverse button, compass-direction steering, analog radial travel, a 16%
centre dead zone and one-shot delivery. `src/input.ts` handles device priority
and cancellation. Keyboard use or a connected standard gamepad hides the sticks;
a new touch returns to mobile input when no controller is connected. Browsers do
not expose reliable physical-keyboard presence, so keyboard use is the signal.
The gamepad left vertical axis also supplies thrust and brake/reverse; RT/LT remain
available. No touch option or forced mobile mode is added to the production game.

`src/touch-controls.css` reserves thumb space, adapts HUD placement for portrait and
landscape, and respects safe-area insets. The flight controls are hidden over menus.
Pointer release, cancellation, lost capture, resize, blur, tab visibility changes,
pause, death and level changes clear held input. Extra pointers cannot steal a stick
or release the reverse button.

## Verified

- `npm test`: **70/70 passed**, including direction steering, reverse,
  aiming, dead-zone and visibility tests.
- `npm run build`: **passed**, including TypeScript checks. Existing Three.js chunk
  size warning remains; no new runtime dependency was added.
- `/tests/browser.html`: **127 checks passed**, covering simultaneous touch flight
  and laser aiming, a southward turn and forward flight through the real simulation,
  reverse-button braking and backwards flight, independent release, extra-pointer
  ownership, cancellation, delivery, resize/blur/pause reset, gamepad and keyboard
  handoff, button focus, and the existing full expeditions/rendering checks.
  [Saved output](../screenshots/touch-controls/browser-checks.txt).
- Inspected the actual game HUD at **390 × 844**, **320 × 568**, **844 × 390** and
  **568 × 320** using `/tests/touch.html`. Pause, restart and level selection worked.
  No errors were reported by the mobile preview browser console.

The desktop preview fixture emulates touch capability and treats button clicks as
touch-mode selection. Integration checks use synthetic PointerEvents and a mocked
standard gamepad. Native phone multitouch, native pointer capture outside a pad,
physical gamepad hardware, device-specific safe areas and mobile GPU performance
still need a real-device pass. These checks do not establish a mobile FPS claim.
Both fixtures are development-only and excluded from the production build.

## Captures

- [Aster portrait](../screenshots/touch-controls/aster-portrait.jpg)
- [Aster landscape](../screenshots/touch-controls/aster-landscape.jpg)
- [Aster small portrait](../screenshots/touch-controls/aster-small-portrait.jpg)
- [Asteroid belt landscape](../screenshots/touch-controls/belt-landscape.jpg)
- [Asteroid belt small landscape](../screenshots/touch-controls/belt-small-landscape.jpg)
