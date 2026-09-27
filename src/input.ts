import { deadzone, neutralInput, type FlightInput } from './simulation';

export class Controls {
  private keys = new Set<string>();
  private unloadQueued = false;
  private padUnloadHeld = false;
  pointer = { x: 0, y: 0, active: false };
  gamepadConnected = false;
  constructor(canvas: HTMLCanvasElement, togglePause: () => void) {
    window.addEventListener('keydown', e => {
      if (['Space', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'KeyX', 'ShiftLeft', 'ShiftRight'].includes(e.code)) e.preventDefault();
      if (e.code === 'Escape' && !e.repeat) togglePause();
      if (e.code === 'KeyE' && !e.repeat && !this.keys.has(e.code)) this.unloadQueued = true;
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.clear());
    document.addEventListener('visibilitychange', () => this.clear());
    canvas.addEventListener('pointermove', e => {
      const r = canvas.getBoundingClientRect();
      this.pointer = { x: (e.clientX - r.left) / r.width * 2 - 1,
        y: -(e.clientY - r.top) / r.height * 2 + 1, active: true };
    });
    canvas.addEventListener('pointerleave', () => { this.pointer.active = false; });
  }
  clear() { this.keys.clear(); this.pointer.active = false; this.unloadQueued = false; }
  read(mouseAim: number | null): FlightInput {
    const has = (...codes: string[]) => codes.some(c => this.keys.has(c));
    const input = neutralInput();
    input.thrust = has('KeyW', 'ArrowUp') ? 1 : 0;
    input.brake = has('Space') ? 1 : 0;
    input.steer = Number(has('KeyD', 'ArrowRight')) - Number(has('KeyA', 'ArrowLeft'));
    input.aim = this.pointer.active ? mouseAim : null;
    input.mine = has('KeyX', 'ShiftLeft', 'ShiftRight');
    input.unloadPressed = this.unloadQueued; this.unloadQueued = false;
    const pad = Array.from(navigator.getGamepads?.() ?? []).find(p => p?.connected && p.mapping === 'standard');
    this.gamepadConnected = !!pad;
    if (pad) {
      const steer = deadzone(pad.axes[0] ?? 0);
      if (Math.abs(steer) > Math.abs(input.steer)) input.steer = steer;
      input.thrust = Math.max(input.thrust, pad.buttons[7]?.value ?? 0);
      input.brake = Math.max(input.brake, pad.buttons[6]?.value ?? 0);
      input.mine ||= !!pad.buttons[5]?.pressed;
      const unload = !!pad.buttons[3]?.pressed;
      input.unloadPressed ||= unload && !this.padUnloadHeld;
      this.padUnloadHeld = unload;
      const x = pad.axes[2] ?? 0, y = pad.axes[3] ?? 0;
      if (Math.hypot(x, y) > 0.2) input.aim = Math.atan2(x, -y);
    }
    else this.padUnloadHeld = false;
    return input;
  }
}
