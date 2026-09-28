import { CONFIG } from './config';

export interface MotionInput { thrust:number; brake:number; brakePressed:boolean; handbrake:number; steer:number }
export interface ThrustForces { forward:number; side:number; yaw:number }
export interface MotionState {
  vx:number; vz:number; heading:number; yawRate:number; grip:number;
  brakeHeld:boolean; reverseArmed:boolean; driveAction:'brake'|'reverse';
  drifting:boolean; gliding:boolean; forces:ThrustForces;
}
export const MOTION = {
  stopped:.3, groundGrip:8, driftGrip:1.8, driftTurnRate:2.4, driftDrag:1.5,
  spaceAcceleration:12, spaceDrag:.03, spaceGrip:.65, spaceCorrection:8, recoverySeconds:.4,
} as const;
export const motionState=():Omit<MotionState,'heading'>=>({vx:0,vz:0,yawRate:0,grip:1,
  brakeHeld:false,reverseArmed:false,driveAction:'brake',drifting:false,gliding:false,forces:{forward:0,side:0,yaw:0}});
export const flightSpeed=(s:{vx:number;vz:number})=>Math.hypot(s.vx,s.vz);
export const forwardSpeed=(s:{vx:number;vz:number;heading:number})=>s.vx*Math.sin(s.heading)-s.vz*Math.cos(s.heading);
export const sideSpeed=(s:{vx:number;vz:number;heading:number})=>s.vx*Math.cos(s.heading)+s.vz*Math.sin(s.heading);
/** Set complete velocity for fixtures, respawns and scripted flybys. */
export function setVelocity(s:{vx:number;vz:number;heading:number},forward:number,side=0) {
  s.vx=Math.sin(s.heading)*forward+Math.cos(s.heading)*side;
  s.vz=-Math.cos(s.heading)*forward+Math.sin(s.heading)*side;
}
export function resetDrive(s:MotionState) {
  s.brakeHeld=false;s.reverseArmed=false;s.driveAction='brake';s.drifting=s.gliding=false;
  s.forces={forward:0,side:0,yaw:0};
}
/** Run once per input frame, never once for every simulation substep. */
export function beginDriveInput(s:MotionState,input:MotionInput) {
  const held=input.brake>.05,stopped=flightSpeed(s)<=MOTION.stopped;
  if(s.brakeHeld&&!held&&s.driveAction==='brake'&&stopped)s.reverseArmed=true;
  if(!held&&(!stopped||input.thrust>0))s.reverseArmed=false;
  if(held&&(input.brakePressed||!s.brakeHeld)) {
    s.driveAction=s.reverseArmed&&stopped?'reverse':'brake';s.reverseArmed=false;
  }
  if(!held)s.driveAction='brake';
  s.brakeHeld=held;
}
const clamp=(n:number,min:number,max:number)=>Math.max(min,Math.min(max,n));
function slow(s:MotionState,amount:number) {
  const speed=flightSpeed(s),scale=speed>0?Math.max(0,1-amount/speed):0;
  s.vx*=scale;s.vz*=scale;
}
/** Local active forces exclude passive drag and collision impulses. */
export function stepMotion(s:MotionState,input:MotionInput,space:boolean,dt:number) {
  const speed=flightSpeed(s),forward=forwardSpeed(s),hand=clamp(input.handbrake,0,1);
  s.drifting=!space&&hand>.05&&speed>=5;s.gliding=space&&hand>.05;
  const gripTarget=(s.drifting||s.gliding)?1-hand:1;
  // Releasing the handbrake restores assistance smoothly; engaging free glide
  // disables correction immediately, including its first simulation step.
  s.grip=gripTarget<s.grip?gripTarget:Math.min(gripTarget,s.grip+dt/MOTION.recoverySeconds);
  const turnRate=s.drifting?MOTION.driftTurnRate:CONFIG.turnRate;
  const reverseSteer=!space&&forward<-.3?-1:1;
  const targetYaw=clamp(input.steer,-1,1)*turnRate*reverseSteer;
  const oldYaw=s.yawRate;
  s.yawRate+=(targetYaw-s.yawRate)*(1-Math.exp(-dt*(space?6:12)));
  s.heading+=s.yawRate*dt;
  const fx=Math.sin(s.heading),fz=-Math.cos(s.heading),rx=Math.cos(s.heading),rz=Math.sin(s.heading);
  const beforeX=s.vx,beforeZ=s.vz;
  const brake=clamp(input.brake,0,1),thrust=clamp(input.thrust,0,1);
  const lateral=sideSpeed(s),grip=space?MOTION.spaceGrip*s.grip:MOTION.driftGrip+(MOTION.groundGrip-MOTION.driftGrip)*s.grip;
  const sideDelta=-lateral*(1-Math.exp(-grip*dt));
  const correction=space?clamp(sideDelta,-MOTION.spaceCorrection*dt,MOTION.spaceCorrection*dt):sideDelta;
  s.vx+=rx*correction;s.vz+=rz*correction;
  if(brake>.05&&s.driveAction==='brake')slow(s,CONFIG.braking*brake*dt);
  else if(brake>.05) {
    // Reverse control compensates ground drag, so light analog pressure still
    // moves the vehicle and the front engines keep working at cruising speed.
    const compensation=space?0:CONFIG.drag;
    const push=Math.min((CONFIG.reverseAcceleration*brake+compensation)*dt,Math.max(0,CONFIG.maxReverseSpeed+compensation*dt+forwardSpeed(s)));
    s.vx-=fx*push;s.vz-=fz*push;
  } else if(thrust>0) {
    let remaining=dt;
    const longitudinal=forwardSpeed(s);
    if(longitudinal<0) {
      const used=Math.min(dt,-longitudinal/(CONFIG.braking*thrust));
      s.vx+=fx*CONFIG.braking*thrust*used;s.vz+=fz*CONFIG.braking*thrust*used;remaining-=used;
    }
    const push=(space?MOTION.spaceAcceleration:CONFIG.acceleration)*thrust*remaining;
    s.vx+=fx*push;s.vz+=fz*push;
  }
  // Cap powered acceleration without inventing a correction from rotating the hull.
  if(flightSpeed(s)>CONFIG.maxSpeed)slow(s,flightSpeed(s)-CONFIG.maxSpeed);
  s.forces.forward=((s.vx-beforeX)*fx+(s.vz-beforeZ)*fz)/dt;
  s.forces.side=((s.vx-beforeX)*rx+(s.vz-beforeZ)*rz)/dt;
  s.forces.yaw=(s.yawRate-oldYaw)/dt;
  if(space){const drag=Math.exp(-MOTION.spaceDrag*dt);s.vx*=drag;s.vz*=drag;}
  else slow(s,(CONFIG.drag+(s.drifting?MOTION.driftDrag*hand:0))*dt);
  if(flightSpeed(s)<1e-7)s.vx=s.vz=0;
}

export type ThrusterName='exhaust_left'|'exhaust_right'|'reverse_left'|'reverse_right'|'side_left_front'|'side_left_aft'|'side_right_front'|'side_right_aft';
/** Exhaust points opposite the generated force. Opposing fore/aft pairs produce yaw. */
export function thrusterLevels(forces:ThrustForces):Record<ThrusterName,number> {
  const ahead=clamp(forces.forward/CONFIG.acceleration,0,1),back=clamp(-forces.forward/CONFIG.reverseAcceleration,0,1);
  const right=clamp(forces.side/12,0,1),left=clamp(-forces.side/12,0,1);
  const cw=clamp(forces.yaw/8,0,1),ccw=clamp(-forces.yaw/8,0,1);
  return {exhaust_left:ahead,exhaust_right:ahead,reverse_left:back,reverse_right:back,
    side_left_front:Math.max(right,cw),side_left_aft:Math.max(right,ccw),
    side_right_front:Math.max(left,ccw),side_right_aft:Math.max(left,cw)};
}
