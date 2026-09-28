import { neutralInput, type FlightInput } from './simulation';

/** Radial dead zone keeps a resting thumb neutral; diagonal travel stays bounded. */
export function stickVector(x: number, y: number, deadzone = .16) {
  const length = Math.hypot(x,y);
  if(length<=deadzone) return {x:0,y:0};
  const magnitude=(Math.min(1,length)-deadzone)/(1-deadzone);
  return {x:x/length*magnitude,y:y/length*magnitude};
}
export function touchFlightInput(left:{x:number;y:number},right:{x:number;y:number},heading:number,reverseHeld:boolean):FlightInput {
  const travel=Math.hypot(left.x,left.y);
  const direction=travel>0?Math.atan2(left.x,-left.y):heading;
  const error=Math.atan2(Math.sin(direction-heading),Math.cos(direction-heading));
  // The ship has a real turn rate: do not power it in the old direction while it
  // is still turning toward a new stick direction.
  const alignment=Math.max(0,(Math.cos(error)-.1)/.9);
  return {...neutralInput(),steer:travel>0?Math.max(-1,Math.min(1,error/.18)):0,
    thrust:reverseHeld?0:travel*alignment,brake:reverseHeld?1:0,
    aim:Math.hypot(right.x,right.y)>0?Math.atan2(right.x,-right.y):null,mine:Math.hypot(right.x,right.y)>0};
}
export const shouldShowTouch=(capable:boolean,keyboard:boolean,gamepad:boolean,active:boolean)=>capable&&!keyboard&&!gamepad&&active;

interface Stick { element:HTMLElement; knob:HTMLElement; pointer:number|null; centerX:number; centerY:number; radius:number; x:number; y:number }

export class TouchControls {
  readonly element:HTMLElement;
  private sticks:Stick[];
  private unload:HTMLButtonElement;
  private reverse:HTMLButtonElement;
  private reversePointer:number|null=null;
  private reverseHeld=false;
  private unloadQueued=false;
  private abort=new AbortController();
  enabled=false;
  constructor(host:HTMLElement) {
    this.element=document.createElement('section');this.element.className='touch-controls';this.element.hidden=true;
    this.element.setAttribute('aria-label','Touch-Steuerung');
    this.element.innerHTML=`
      <div class="touch-stick touch-flight" data-stick="flight" role="group" aria-label="Flugstick: in die gewünschte Flugrichtung ziehen; weiter auslenken für mehr Schub">
        <span class="stick-caption" aria-hidden="true">FLUGRICHTUNG</span><span class="stick-up" aria-hidden="true">↑</span><span class="stick-cross" aria-hidden="true">‹ <i></i> ›</span><span class="stick-down" aria-hidden="true">↓</span><span class="stick-knob" aria-hidden="true"></span><span class="stick-help" aria-hidden="true">RICHTUNG &amp; SCHUB</span>
      </div>
      <button class="touch-reverse" type="button" aria-label="Rückwärtsgang gedrückt halten"><span aria-hidden="true">⇣</span><small>RÜCKWÄRTS</small></button>
      <button class="touch-unload" type="button" disabled aria-label="Bei ATLAS entladen"><span aria-hidden="true">⇧</span><small>ENTLADEN</small></button>
      <div class="touch-stick touch-aim" data-stick="aim" role="group" aria-label="Zielstick: ziehen zum Zielen und Abbauen, loslassen stoppt den Laser">
        <span class="stick-caption" aria-hidden="true">LASER</span><span class="stick-reticle" aria-hidden="true">+</span><span class="stick-knob" aria-hidden="true"></span><span class="stick-help" aria-hidden="true">ZIEHEN ZUM ABBAU</span>
      </div>`;
    host.append(this.element);this.unload=this.element.querySelector('.touch-unload')!;
    this.reverse=this.element.querySelector('.touch-reverse')!;
    this.sticks=Array.from(this.element.querySelectorAll<HTMLElement>('.touch-stick'),element=>({element,knob:element.querySelector<HTMLElement>('.stick-knob')!,pointer:null,centerX:0,centerY:0,radius:1,x:0,y:0}));
    const signal=this.abort.signal;
    for(const stick of this.sticks) {
      stick.element.addEventListener('pointerdown',event=>{
        if(!this.enabled||stick.pointer!==null||(event.pointerType==='mouse'&&event.button!==0))return;
        event.preventDefault();
        const rect=stick.element.getBoundingClientRect();
        stick.pointer=event.pointerId;stick.centerX=rect.left+rect.width/2;stick.centerY=rect.top+rect.height/2;stick.radius=rect.width*.32;
        // A real pointer is captured outside the pad as well. Synthetic browser
        // fixture events have no active platform pointer to capture.
        try {stick.element.setPointerCapture(event.pointerId);} catch { /* Synthetic or already cancelled pointer. */ }
        stick.element.classList.add('is-active');this.move(stick,event);
      },{signal});
      stick.element.addEventListener('pointermove',event=>{if(stick.pointer===event.pointerId){event.preventDefault();this.move(stick,event);}},{signal});
      for(const type of ['pointerup','pointercancel','lostpointercapture'] as const)
        stick.element.addEventListener(type,event=>{if(stick.pointer===event.pointerId)this.release(stick);},{signal});
      stick.element.addEventListener('contextmenu',event=>event.preventDefault(),{signal});
    }
    this.unload.addEventListener('click',()=>{if(this.enabled&&!this.unload.disabled)this.unloadQueued=true;},{signal});
    this.reverse.addEventListener('pointerdown',event=>{
      if(!this.enabled||this.reversePointer!==null||(event.pointerType==='mouse'&&event.button!==0))return;
      event.preventDefault();this.reversePointer=event.pointerId;this.reverseHeld=true;
      this.reverse.classList.add('is-active');
      try {this.reverse.setPointerCapture(event.pointerId);} catch { /* Synthetic pointer in a browser fixture. */ }
    },{signal});
    for(const type of ['pointerup','pointercancel','lostpointercapture'] as const)
      this.reverse.addEventListener(type,event=>{if(this.reversePointer===event.pointerId)this.releaseReverse();},{signal});
    this.reverse.addEventListener('contextmenu',event=>event.preventDefault(),{signal});
    window.addEventListener('resize',()=>this.clear(),{signal});
  }
  private move(stick:Stick,event:PointerEvent) {
    const rawX=(event.clientX-stick.centerX)/stick.radius,rawY=(event.clientY-stick.centerY)/stick.radius;
    const value=stickVector(rawX,rawY);stick.x=value.x;stick.y=value.y;
    const scale=Math.max(1,Math.hypot(rawX,rawY));
    stick.knob.style.transform=`translate(${rawX/scale*stick.radius}px,${rawY/scale*stick.radius}px)`;
  }
  private release(stick:Stick) {
    const pointer=stick.pointer;stick.pointer=null;stick.x=stick.y=0;
    stick.knob.style.transform='translate(0,0)';stick.element.classList.remove('is-active');
    if(pointer!==null&&stick.element.hasPointerCapture(pointer))stick.element.releasePointerCapture(pointer);
  }
  private releaseReverse() {
    const pointer=this.reversePointer;this.reversePointer=null;this.reverseHeld=false;
    this.reverse.classList.remove('is-active');
    if(pointer!==null&&this.reverse.hasPointerCapture(pointer))this.reverse.releasePointerCapture(pointer);
  }
  setEnabled(enabled:boolean) {
    if(this.enabled===enabled)return;
    this.enabled=enabled;this.element.hidden=!enabled;if(!enabled)this.clear();
  }
  setUnloadAvailable(available:boolean) {this.unload.disabled=!available;}
  clear() {this.sticks.forEach(stick=>this.release(stick));this.releaseReverse();this.unloadQueued=false;}
  read(heading:number):FlightInput {
    if(!this.enabled)return neutralInput();
    const input=touchFlightInput(this.sticks[0],this.sticks[1],heading,this.reverseHeld);input.unloadPressed=this.unloadQueued;this.unloadQueued=false;return input;
  }
  dispose() {this.setEnabled(false);this.abort.abort();this.element.remove();}
}
