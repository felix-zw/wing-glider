import { neutralInput, type FlightInput } from './simulation';

export function stickVector(x:number,y:number,deadzone=.16) {
  const length=Math.hypot(x,y);if(length<=deadzone)return {x:0,y:0};
  const magnitude=(Math.min(1,length)-deadzone)/(1-deadzone);
  return {x:x/length*magnitude,y:y/length*magnitude};
}
export function touchFlightInput(left:{x:number;y:number},right:{x:number;y:number},throttle:number,brake:number,handbrake:number):FlightInput {
  return {...neutralInput(),steer:left.x,thrust:brake?0:throttle,brake,handbrake,
    aim:Math.hypot(right.x,right.y)>0?Math.atan2(right.x,-right.y):null,mine:Math.hypot(right.x,right.y)>0};
}
export const shouldShowTouch=(capable:boolean,keyboard:boolean,gamepad:boolean,active:boolean)=>capable&&!keyboard&&!gamepad&&active;

/** A long hold never counts as a tap. A tap on latched gas always releases it. */
export class TouchThrottle {
  held=false;latched=false;
  private start=0;private lastTap=-Infinity;private unlatching=false;
  down(now:number){this.start=now;this.unlatching=this.latched;this.held=!this.latched;if(this.latched)this.clearLatch();}
  up(now:number){
    this.held=false;
    if(!this.unlatching&&now-this.start<=200){
      if(now-this.lastTap<=300){this.latched=true;this.lastTap=-Infinity;}else this.lastTap=now;
    }else this.lastTap=-Infinity;
    this.unlatching=false;
  }
  clearLatch(){this.latched=false;this.lastTap=-Infinity;}
  clear(){this.held=false;this.unlatching=false;this.clearLatch();}
}
interface Stick { element:HTMLElement; knob:HTMLElement; pointer:number|null; centerX:number; centerY:number; radius:number; x:number; y:number }
interface Pedal {element:HTMLButtonElement;name:'gas'|'brake'|'handbrake';pointer:number|null}
export class TouchControls {
  readonly element:HTMLElement;
  readonly throttle=new TouchThrottle();
  private sticks:Stick[];private pedals:Pedal[];
  private unload:HTMLButtonElement;private unloadQueued=false;
  private abort=new AbortController();enabled=false;
  constructor(host:HTMLElement,private onCancel:()=>void=()=>{}) {
    this.element=document.createElement('section');this.element.className='touch-controls';this.element.hidden=true;
    this.element.setAttribute('aria-label','Touch-Steuerung');
    this.element.innerHTML=`
      <div class="touch-stick touch-flight" data-stick="flight" role="group" aria-label="Lenkstick: links und rechts relativ zum Fahrzeug lenken">
        <span class="stick-caption" aria-hidden="true">LENKEN</span><span class="stick-cross" aria-hidden="true">‹ <i></i> ›</span><span class="stick-knob" aria-hidden="true"></span><span class="stick-help" aria-hidden="true">LINKS / RECHTS</span>
      </div>
      <button class="touch-pedal touch-gas" type="button" aria-label="Gas halten, Doppeltipp für Dauergas" aria-pressed="false"><span aria-hidden="true">↑</span><small>GAS</small></button>
      <button class="touch-pedal touch-handbrake" type="button" aria-label="Handbremse zum Driften halten"><span aria-hidden="true">↝</span><small>DRIFT</small></button>
      <button class="touch-pedal touch-brake" type="button" aria-label="Bremsen; nach Stillstand loslassen und erneut halten für rückwärts"><span aria-hidden="true">⇣</span><small>BREMSE / R</small></button>
      <button class="touch-unload" type="button" disabled aria-label="Bei ATLAS entladen"><span aria-hidden="true">⇧</span><small>ENTLADEN</small></button>
      <div class="touch-stick touch-aim" data-stick="aim" role="group" aria-label="Zielstick: ziehen zum Zielen und Abbauen, loslassen stoppt den Laser">
        <span class="stick-caption" aria-hidden="true">LASER</span><span class="stick-reticle" aria-hidden="true">+</span><span class="stick-knob" aria-hidden="true"></span><span class="stick-help" aria-hidden="true">ZIEHEN ZUM ABBAU</span>
      </div>`;
    host.append(this.element);this.unload=this.element.querySelector('.touch-unload')!;
    this.sticks=Array.from(this.element.querySelectorAll<HTMLElement>('.touch-stick'),element=>({element,knob:element.querySelector<HTMLElement>('.stick-knob')!,pointer:null,centerX:0,centerY:0,radius:1,x:0,y:0}));
    this.pedals=(['gas','brake','handbrake'] as const).map(name=>({name,element:this.element.querySelector<HTMLButtonElement>('.touch-'+name)!,pointer:null}));
    const signal=this.abort.signal;
    for(const stick of this.sticks) {
      stick.element.addEventListener('pointerdown',event=>{
        if(!this.enabled||stick.pointer!==null||(event.pointerType==='mouse'&&event.button!==0))return;
        event.preventDefault();const rect=stick.element.getBoundingClientRect();
        stick.pointer=event.pointerId;stick.centerX=rect.left+rect.width/2;stick.centerY=rect.top+rect.height/2;stick.radius=rect.width*.32;
        this.capture(stick.element,event.pointerId);stick.element.classList.add('is-active');this.move(stick,event);
      },{signal});
      stick.element.addEventListener('pointermove',event=>{if(stick.pointer===event.pointerId){event.preventDefault();this.move(stick,event);}},{signal});
      for(const type of ['pointerup','pointercancel','lostpointercapture'] as const)
        stick.element.addEventListener(type,event=>{if(stick.pointer===event.pointerId){this.releaseStick(stick);if(type!=='pointerup'){this.throttle.clear();this.onCancel();}}},{signal});
    }
    for(const pedal of this.pedals){
      pedal.element.addEventListener('pointerdown',event=>{
        if(!this.enabled||pedal.pointer!==null||(event.pointerType==='mouse'&&event.button!==0))return;
        event.preventDefault();pedal.pointer=event.pointerId;this.capture(pedal.element,event.pointerId);
        if(pedal.name==='gas')this.throttle.down(event.timeStamp);
        if(pedal.name==='brake')this.throttle.clearLatch();
        this.updatePedals();
      },{signal});
      for(const type of ['pointerup','pointercancel','lostpointercapture'] as const)
        pedal.element.addEventListener(type,event=>{
          if(pedal.pointer!==event.pointerId)return;
          if(type!=='pointerup'){this.throttle.clear();this.onCancel();}
          else if(pedal.name==='gas')this.throttle.up(event.timeStamp);
          this.releasePedal(pedal);this.updatePedals();
        },{signal});
    }
    this.element.addEventListener('contextmenu',event=>event.preventDefault(),{signal});
    this.unload.addEventListener('click',()=>{if(this.enabled&&!this.unload.disabled)this.unloadQueued=true;},{signal});
    window.addEventListener('resize',()=>this.clear(),{signal});
  }
  private capture(element:HTMLElement,id:number){try{element.setPointerCapture(id);}catch{/* Synthetic fixture pointers have no platform capture. */}}
  private move(stick:Stick,event:PointerEvent) {
    const x=(event.clientX-stick.centerX)/stick.radius,y=(event.clientY-stick.centerY)/stick.radius;
    const value=stickVector(x,y);stick.x=value.x;stick.y=value.y;
    const scale=Math.max(1,Math.hypot(x,y));stick.knob.style.transform='translate('+(x/scale*stick.radius)+'px,'+(y/scale*stick.radius)+'px)';
  }
  private releaseStick(stick:Stick){const id=stick.pointer;stick.pointer=null;stick.x=stick.y=0;stick.knob.style.transform='translate(0,0)';stick.element.classList.remove('is-active');if(id!==null&&stick.element.hasPointerCapture(id))stick.element.releasePointerCapture(id);}
  private releasePedal(pedal:Pedal){const id=pedal.pointer;pedal.pointer=null;pedal.element.classList.remove('is-active');if(id!==null&&pedal.element.hasPointerCapture(id))pedal.element.releasePointerCapture(id);}
  private updatePedals(){
    for(const p of this.pedals)p.element.classList.toggle('is-active',p.pointer!==null||(p.name==='gas'&&this.throttle.latched));
    const gas=this.pedals[0].element;gas.classList.toggle('is-latched',this.throttle.latched);gas.setAttribute('aria-pressed',String(this.throttle.latched));gas.querySelector('small')!.textContent=this.throttle.latched?'GAS FIX':'GAS';
  }
  setEnvironment(space:boolean){const button=this.pedals[2].element;button.querySelector('small')!.textContent=space?'GLEITEN':'DRIFT';button.setAttribute('aria-label',space?'Für freies Gleiten halten':'Handbremse zum Driften halten');}
  setEnabled(enabled:boolean){if(this.enabled===enabled)return;this.enabled=enabled;this.element.hidden=!enabled;if(!enabled)this.clear();}
  setUnloadAvailable(available:boolean){this.unload.disabled=!available;}
  clear(){this.sticks.forEach(s=>this.releaseStick(s));this.pedals.forEach(p=>this.releasePedal(p));this.throttle.clear();this.updatePedals();this.unloadQueued=false;}
  read():FlightInput {
    if(!this.enabled)return neutralInput();
    const brake=Number(this.pedals[1].pointer!==null);if(brake)this.throttle.clearLatch();
    const input=touchFlightInput(this.sticks[0],this.sticks[1],Number(this.throttle.held||this.throttle.latched),brake,Number(this.pedals[2].pointer!==null));
    input.unloadPressed=this.unloadQueued;this.unloadQueued=false;this.updatePedals();return input;
  }
  dispose(){this.setEnabled(false);this.abort.abort();this.element.remove();}
}
