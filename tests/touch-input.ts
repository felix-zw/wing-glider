import { forwardSpeed, setVelocity } from '../src/flight-motion';
import '../src/touch-controls.css';
import { Controls } from '../src/input';
import { advance, createState } from '../src/simulation';

export function checkTouchControls(controls:Controls,canvas:HTMLCanvasElement,check:(condition:unknown,message:string)=>void) {
  const find=(selector:string)=>controls.touch.element.querySelector<HTMLElement>(selector)!;
  const left=find('[data-stick=flight]'),right=find('[data-stick=aim]'),gas=find('.touch-gas'),brake=find('.touch-brake'),hand=find('.touch-handbrake');
  const button=find('.touch-unload') as HTMLButtonElement;
  let time=1000;
  const pointer=(element:HTMLElement,type:string,id:number,x=0,y=0)=>{
    const rect=element.getBoundingClientRect();
    const event=new PointerEvent(type,{bubbles:true,cancelable:true,pointerType:'touch',pointerId:id,
      clientX:rect.left+rect.width/2+x*rect.width*.32,clientY:rect.top+rect.height/2+y*rect.width*.32});
    Object.defineProperty(event,'timeStamp',{value:time+=50});element.dispatchEvent(event);
  };
  const latch=()=>{pointer(gas,'pointerdown',20);pointer(gas,'pointerup',20);pointer(gas,'pointerdown',20);pointer(gas,'pointerup',20);};
  const original=Object.getOwnPropertyDescriptor(navigator,'getGamepads');
  const buttons=Array.from({length:8},()=>({pressed:false,value:0}));
  const pad={connected:true,mapping:'standard',axes:[0,0,0,0],buttons};
  let connected=false;
  Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>connected?[pad]:[]});
  try {
    controls.clear();controls.setActive(true);controls.read(null);
    pointer(canvas,'pointerdown',99);
    check(controls.touch.enabled&&!controls.touch.element.hidden,'Touch input reveals pads during active play');
    pointer(left,'pointerdown',1,1,0);pointer(right,'pointerdown',2,1,0);pointer(gas,'pointerdown',3);
    let input=controls.read(null);
    check(input.steer>.99&&input.thrust===1&&input.mine&&Math.abs(input.aim!-Math.PI/2)<1e-5,'Independent fingers steer, hold gas and aim/mine simultaneously');
    pointer(left,'pointerdown',4,-1,0);pointer(left,'pointerup',4);
    check(controls.read(null).steer>.99,'Extra pointers cannot steal an occupied stick');
    time+=400;pointer(gas,'pointerup',3);input=controls.read(null);
    check(input.thrust===0&&input.mine&&input.steer>.99,'Releasing held gas leaves both sticks active');
    pointer(right,'pointercancel',2);pointer(left,'pointerup',1);
    check(!controls.read(null).mine,'Cancelled aim pointer stops the laser');
    pointer(left,'pointerdown',5,0,-1);input=controls.read(null);
    check(!input.thrust&&!input.steer&&!input.brake,'Vertical steering-stick travel never selects gas or reverse');
    pointer(left,'pointermove',5,-4,0);check(controls.read(null).steer===-1,'Relative steering travel is bounded');
    pointer(left,'lostpointercapture',5);check(!controls.read(null).steer,'Lost capture releases steering');
    latch();input=controls.read(null);
    check(input.thrust===1&&gas.getAttribute('aria-pressed')==='true','Gas double tap latches visibly after fingers release');
    pointer(hand,'pointerdown',6);input=controls.read(null);
    check(input.thrust===1&&input.handbrake===1,'Handbrake preserves latched gas for two-thumb drifting');
    controls.touch.setEnvironment(true);
    check(hand.textContent?.includes('GLEITEN'),'Space changes the drift button to free glide');
    controls.touch.setEnvironment(false);pointer(hand,'pointerup',6);
    pointer(brake,'pointerdown',7);input=controls.read(null);
    check(input.brake===1&&input.brakePressed&&input.thrust===0&&!controls.touch.throttle.latched,'Normal brake cancels latched gas and emits one press edge');
    check(!controls.read(null).brakePressed,'Held brake does not repeat its press edge');
    const ship=createState();setVelocity(ship,12);advance(ship,input,1);
    check(ship.speed===0,'Touch brake stops and holds at rest');
    advance(ship,controls.read(null),.5);check(ship.speed===0,'Continuing to hold brake never starts reverse');
    pointer(brake,'pointerup',7);advance(ship,controls.read(null),.01);
    pointer(brake,'pointerdown',7);advance(ship,controls.read(null),.5);
    check(forwardSpeed(ship)<0,'Releasing then pressing touch brake starts slow reverse');
    pointer(brake,'pointerdown',8);pointer(brake,'pointerup',8);
    check(controls.read(null).brake===1,'An extra finger cannot release a held brake');
    pointer(brake,'pointercancel',7);check(!controls.read(null).brake,'Cancelled brake releases input');
    latch();pointer(gas,'pointerdown',20);pointer(gas,'pointerup',20);
    check(!controls.read(null).thrust,'A single tap on latched gas turns it off');
    controls.touch.setUnloadAvailable(false);button.click();check(!controls.read(null).unloadPressed,'Disabled unloading cannot queue a delivery');
    controls.touch.setUnloadAvailable(true);button.click();input=controls.read(null);
    check(input.unloadPressed&&!controls.read(null).unloadPressed,'Touch unloading is a single press');
    const delivery=createState();delivery.x=delivery.z=0;delivery.resources.cargo.ferrite=2;advance(delivery,input,.01);
    check(delivery.resources.storage.ferrite===2,'Touch unloading delivers cargo through the simulation');
    for(const event of ['resize','blur']) {
      latch();pointer(right,'pointerdown',9,1,0);pointer(hand,'pointerdown',10);
      window.dispatchEvent(new Event(event));input=controls.read(null);
      check(!input.thrust&&!input.mine&&!input.handbrake,event+' clears gas latch, laser and handbrake');
    }
    latch();controls.setActive(false);controls.setActive(true);input=controls.read(null);
    check(!input.thrust&&!input.brake&&!input.handbrake,'Pause and resume never restore old controls');
    latch();connected=true;input=controls.read(null);
    check(!controls.touch.enabled&&!input.thrust,'Gamepad handoff cancels latched touch gas');
    pad.axes[1]=-.8;input=controls.read(null);
    check(!input.thrust&&!input.brake,'Gamepad left stick vertical travel has no pedal function');
    buttons[7].value=.6;buttons[6].value=.3;buttons[0].value=1;pad.axes[0]=.7;input=controls.read(null);
    check(input.thrust===.6&&input.brake===.3&&input.handbrake===1&&input.steer>0,'Gamepad RT, LT, A and horizontal left stick remain independent');
    connected=false;input=controls.read(null);
    check(controls.touch.enabled&&!input.thrust&&!input.handbrake,'Gamepad disconnect restores neutral touch controls');
    latch();window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyW'}));input=controls.read(null);
    check(!controls.touch.enabled&&input.thrust===1,'Keyboard takes over from touch');
    pointer(canvas,'pointerdown',99);input=controls.read(null);
    check(controls.touch.enabled&&!input.thrust,'Touch handoff clears stale keyboard and latched gas');
    button.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,code:'Space'}));
    check(!controls.read(null).handbrake,'Space on a focused button remains button activation');
    controls.setActive(false);pointer(canvas,'pointerdown',99);
    check(!controls.touch.enabled,'Touching a paused game cannot activate flight controls');
  } finally {
    controls.setActive(false);controls.clear();
    if(original)Object.defineProperty(navigator,'getGamepads',original);else Reflect.deleteProperty(navigator,'getGamepads');
    controls.read(null);
  }
}
