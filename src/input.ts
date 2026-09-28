import { deadzone, neutralInput, type FlightInput } from './simulation';
import { TouchControls, shouldShowTouch } from './touch-controls';

export class Controls {
  private keys = new Set<string>();
  private unloadQueued = false;
  private padUnloadHeld = false;
  private keyboardUsed=false;
  private touchSeen=false;
  private active=false;
  private abort=new AbortController();
  readonly touch:TouchControls;
  pointer = { x: 0, y: 0, active: false };
  gamepadConnected = false;
  constructor(canvas: HTMLCanvasElement, togglePause: () => void, private options:{touchCapable?:()=>boolean}={}) {
    this.touch=new TouchControls(canvas.parentElement??document.body);
    const signal=this.abort.signal;
    window.addEventListener('keydown', e => {
      this.keyboardUsed=true;this.refreshTouch();
      if(e.target instanceof HTMLElement&&e.code!=='Escape'&&(
        e.target.matches('input,select,textarea,[contenteditable="true"]')||
        (e.target.closest('button')&&['Enter','Space'].includes(e.code))))return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyX', 'ShiftLeft', 'ShiftRight'].includes(e.code)) e.preventDefault();
      if (e.code === 'Escape' && !e.repeat) togglePause();
      if (e.code === 'KeyE' && !e.repeat && !this.keys.has(e.code)) this.unloadQueued = true;
      this.keys.add(e.code);
    },{signal});
    window.addEventListener('keyup', e => this.keys.delete(e.code),{signal});
    window.addEventListener('blur', () => this.clear(),{signal});
    document.addEventListener('visibilitychange', () => this.clear(),{signal});
    window.addEventListener('pointerdown',event=>{
      if(event.pointerType==='touch'){this.touchSeen=true;this.keyboardUsed=false;this.keys.clear();this.unloadQueued=false;this.pointer.active=false;this.refreshTouch();}
    },{signal,capture:true});
    window.addEventListener('gamepadconnected',()=>{this.gamepadConnected=true;this.refreshTouch();},{signal});
    window.addEventListener('gamepaddisconnected',()=>{this.gamepadConnected=!!this.gamepad();this.refreshTouch();},{signal});
    canvas.addEventListener('pointermove', e => {
      if(e.pointerType==='touch')return;
      const r = canvas.getBoundingClientRect();
      this.pointer = { x: (e.clientX - r.left) / r.width * 2 - 1,
        y: -(e.clientY - r.top) / r.height * 2 + 1, active: true };
    },{signal});
    canvas.addEventListener('pointerleave', () => { this.pointer.active = false; },{signal});
  }
  private gamepad() {return Array.from(navigator.getGamepads?.()??[]).find(p=>p?.connected&&p.mapping==='standard');}
  private refreshTouch() {
    const capable=this.touchSeen||(this.options.touchCapable?.()??(navigator.maxTouchPoints>0&&matchMedia('(any-pointer: coarse)').matches));
    this.touch.setEnabled(shouldShowTouch(capable,this.keyboardUsed,this.gamepadConnected,this.active));
  }
  setActive(active:boolean) {this.active=active;this.refreshTouch();}
  clear() { this.keys.clear(); this.pointer.active = false; this.unloadQueued = false; this.touch.clear(); }
  dispose() {this.clear();this.abort.abort();this.touch.dispose();}
  read(mouseAim: number | null, heading=0): FlightInput {
    const has = (...codes: string[]) => codes.some(c => this.keys.has(c));
    const input = neutralInput();
    input.thrust = has('KeyW', 'ArrowUp') ? 1 : 0;
    input.brake = has('Space', 'KeyS', 'ArrowDown') ? 1 : 0;
    input.steer = Number(has('KeyD', 'ArrowRight')) - Number(has('KeyA', 'ArrowLeft'));
    input.aim = this.pointer.active ? mouseAim : null;
    input.mine = has('KeyX', 'ShiftLeft', 'ShiftRight');
    input.unloadPressed = this.unloadQueued; this.unloadQueued = false;
    const pad = this.gamepad();
    this.gamepadConnected = !!pad;
    this.refreshTouch();
    if(this.touch.enabled) {
      const touch=this.touch.read(heading);
      input.steer=touch.steer;input.thrust=touch.thrust;input.brake=touch.brake;
      input.aim=touch.aim;input.mine=touch.mine;input.unloadPressed||=touch.unloadPressed;
    }
    if (pad) {
      const steer = deadzone(pad.axes[0] ?? 0);
      if (Math.abs(steer) > Math.abs(input.steer)) input.steer = steer;
      const vertical=deadzone(pad.axes[1]??0);
      input.thrust = Math.max(input.thrust, -vertical, pad.buttons[7]?.value ?? 0);
      input.brake = Math.max(input.brake, vertical, pad.buttons[6]?.value ?? 0);
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
