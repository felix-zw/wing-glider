import '../src/touch-controls.css';
import { Controls } from '../src/input';
import { advance, createState } from '../src/simulation';

export function checkTouchControls(controls:Controls,canvas:HTMLCanvasElement,check:(condition:unknown,message:string)=>void) {
  const left=controls.touch.element.querySelector<HTMLElement>('[data-stick=flight]')!;
  const right=controls.touch.element.querySelector<HTMLElement>('[data-stick=aim]')!;
  const button=controls.touch.element.querySelector<HTMLButtonElement>('.touch-unload')!;
  const reverse=controls.touch.element.querySelector<HTMLButtonElement>('.touch-reverse')!;
  const pointer=(element:HTMLElement,type:string,id:number,x=0,y=0)=>{
    const rect=element.getBoundingClientRect();
    element.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerType:'touch',pointerId:id,
      clientX:rect.left+rect.width/2+x*rect.width*.32,clientY:rect.top+rect.height/2+y*rect.width*.32}));
  };
  const original=Object.getOwnPropertyDescriptor(navigator,'getGamepads');
  const pad={connected:true,mapping:'standard',axes:[0,0,0,0],buttons:[]};
  let connected=false;
  Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>connected?[pad]:[]});
  try {
    controls.clear();controls.setActive(true);controls.read(null);
    pointer(canvas,'pointerdown',99);
    check(controls.touch.enabled&&!controls.touch.element.hidden,'Touch input reveals pads during active play');
    pointer(left,'pointerdown',1,0,-1);pointer(right,'pointerdown',2,1,0);
    let input=controls.read(null);
    check(input.thrust>.99&&input.mine&&Math.abs(input.aim!-Math.PI/2)<1e-5,'Two fingers simultaneously fly and aim/mine');
    pointer(left,'pointerdown',3,0,1);pointer(left,'pointermove',3,0,1);pointer(left,'pointerup',3);
    check(controls.read(null).thrust>.99,'A third pointer cannot steal or release an occupied stick');
    pointer(left,'pointerup',1);input=controls.read(null);
    check(input.thrust===0&&input.mine,'Releasing flight finger leaves the independent laser finger active');
    pointer(right,'pointercancel',2);input=controls.read(null);
    check(!input.mine&&input.aim===null,'Cancelled aim pointer stops laser and releases aim');
    pointer(left,'pointerdown',4,0,1);input=controls.read(null);
    check(input.steer>0&&input.thrust===0&&input.brake===0,'Left stick down turns toward the south without selecting reverse');
    const turning=createState();
    for(let i=0;i<110;i++)advance(turning,controls.read(null,turning.heading),.02);
    check(Math.abs(turning.heading-Math.PI)<.1&&turning.speed>0&&turning.z>36,'Holding south rotates then flies forward to the south');
    pointer(left,'lostpointercapture',4);
    check(controls.read(null).steer===0,'Losing pointer capture releases directional steering');
    pointer(reverse,'pointerdown',10);
    const ship=createState();ship.speed=3;advance(ship,controls.read(null),.05);
    check(ship.speed<3&&ship.speed>=0,'Reverse button first brakes forward motion');
    ship.speed=0;advance(ship,controls.read(null),.5);
    check(ship.speed<0&&ship.z>36,'Holding reverse button drives backwards from rest');
    pointer(reverse,'pointerdown',11);pointer(reverse,'pointerup',11);
    check(controls.read(null).brake===1,'An extra finger cannot release a held reverse button');
    pointer(reverse,'pointercancel',10);
    check(controls.read(null).brake===0,'Cancelling reverse button releases reverse');
    pointer(left,'pointerdown',5,0,-4);
    check(controls.read(null).thrust<=1,'Travel outside the stick remains bounded');
    pointer(left,'pointermove',5,0,0);
    check(controls.read(null).thrust===0,'Returning to the centre produces neutral input');
    pointer(left,'pointerup',5);
    controls.touch.setUnloadAvailable(false);button.click();
    check(!controls.read(null).unloadPressed,'Unavailable unloading button cannot queue a delivery');
    controls.touch.setUnloadAvailable(true);button.click();
    input=controls.read(null);
    check(input.unloadPressed&&!controls.read(null).unloadPressed,'Touch unloading is a single press');
    const delivery=createState();delivery.x=delivery.z=0;delivery.resources.cargo.ferrite=2;
    advance(delivery,input,.01);
    check(delivery.resources.storage.ferrite===2&&delivery.resources.cargo.ferrite===0,'Touch button delivers cargo through the real simulation');
    for(const event of ['resize','blur']) {
      pointer(left,'pointerdown',6,0,-1);pointer(right,'pointerdown',7,1,0);pointer(reverse,'pointerdown',12);
      window.dispatchEvent(new Event(event));input=controls.read(null);
      check(!input.thrust&&!input.mine&&!input.brake,`${event} clears both sticks and reverse`);
    }
    pointer(left,'pointerdown',6,0,-1);pointer(right,'pointerdown',7,1,0);pointer(reverse,'pointerdown',12);button.click();
    controls.setActive(false);controls.setActive(true);input=controls.read(null);
    check(!input.thrust&&!input.mine&&!input.brake&&!input.unloadPressed,'Pause and resume never restore old held or queued actions');
    pointer(right,'pointerdown',8,1,0);connected=true;controls.read(null);
    check(!controls.touch.enabled&&controls.touch.element.hidden,'Connected standard gamepad hides and cancels touch controls');
    pad.axes[1]=.7;input=controls.read(null);
    check(input.brake>0&&input.brake<1&&!input.mine,'Gamepad left stick preserves analog reverse without a stale touch laser');
    pad.axes[1]=-.7;check(controls.read(null).thrust>0,'Gamepad left stick up supplies forward thrust');
    connected=false;input=controls.read(null);
    check(controls.touch.enabled&&!input.mine,'Disconnecting the gamepad restores neutral touch controls');
    pointer(left,'pointerdown',9,0,-1);
    window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyW'}));input=controls.read(null);
    check(!controls.touch.enabled&&input.thrust===1,'Keyboard use takes over and hides the sticks');
    pointer(canvas,'pointerdown',99);input=controls.read(null);
    check(controls.touch.enabled&&!input.thrust,'A new touch returns to neutral mobile input without stale keyboard thrust');
    window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyW'}));
    button.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,code:'KeyW'}));
    check(controls.read(null).thrust===1,'Flight keyboard input still works after a HUD button had focus');
    button.dispatchEvent(new KeyboardEvent('keyup',{bubbles:true,code:'KeyW'}));
    button.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,code:'Space'}));
    check(controls.read(null).brake===0,'Space on a focused button keeps button activation separate from flight');
    controls.setActive(false);pointer(canvas,'pointerdown',99);
    check(!controls.touch.enabled,'Touching a paused game cannot activate flight controls');
  } finally {
    controls.setActive(false);controls.clear();
    if(original)Object.defineProperty(navigator,'getGamepads',original);else Reflect.deleteProperty(navigator,'getGamepads');
    controls.read(null);
  }
}
