import test from 'node:test';
import assert from 'node:assert/strict';
import { beginDriveInput, flightSpeed, forwardSpeed, motionState, resetDrive, setVelocity, sideSpeed, stepMotion, thrusterLevels, type MotionInput, type MotionState } from './flight-motion';

const state=():MotionState=>({heading:0,...motionState()});
const input=(overrides:Partial<MotionInput>={}):MotionInput=>({thrust:0,brake:0,brakePressed:false,handbrake:0,steer:0,...overrides});
function run(s:MotionState,control:Partial<MotionInput>,seconds:number,space=false) {
  const i=input(control);beginDriveInput(s,i);
  for(let t=0;t<seconds-1e-9;t+=1/120)stepMotion(s,i,space,Math.min(1/120,seconds-t));
}
test('held braking stops at zero, release then a new press enables slow reverse',()=>{
  const s=state();setVelocity(s,22,3);
  run(s,{brake:1,thrust:1},2);assert.equal(flightSpeed(s),0);
  run(s,{brake:1},1);assert.equal(flightSpeed(s),0);
  run(s,{},.01);assert.ok(s.reverseArmed);
  run(s,{brake:1},.5);assert.ok(forwardSpeed(s)<-2.4);
  run(s,{brake:1},3);assert.ok(Math.abs(forwardSpeed(s)+6)<1e-8);
  assert.ok(thrusterLevels(s.forces).reverse_left>.5,'front engines compensate drag while holding capped reverse');
  run(s,{thrust:1},1);assert.ok(forwardSpeed(s)>0);assert.ok(!s.reverseArmed);
});
test('reverse cannot arm while sliding or survive a control reset',()=>{
  const s=state();setVelocity(s,0,12);
  run(s,{brake:1},.01,true);run(s,{},.01,true);assert.ok(!s.reverseArmed);
  run(s,{brake:1},1,true);run(s,{},.01,true);assert.ok(s.reverseArmed);
  resetDrive(s);run(s,{brake:1},1,true);assert.equal(flightSpeed(s),0);
});
test('space free glide keeps its trajectory while the hull turns; assist restores alignment gradually',()=>{
  const s=state();setVelocity(s,25);
  run(s,{handbrake:1,steer:1},1,true);
  assert.ok(s.heading>1.5&&Math.abs(s.vx)<1e-8);
  assert.ok(s.vz<-24&&s.gliding);assert.equal(s.forces.side,0);
  const slip=Math.abs(sideSpeed(s));run(s,{},.4,true);
  assert.ok(s.grip>.99&&!s.gliding);assert.ok(Math.abs(sideSpeed(s))>slip*.5,'regripping does not snap the trajectory');
  run(s,{},2,true);assert.ok(Math.abs(sideSpeed(s))<slip*.6);
});
test('Aster handbrake widens the drift and releasing it recovers grip without a boost',()=>{
  const normal=state(),drift=state();setVelocity(normal,28);setVelocity(drift,28);
  run(normal,{steer:.7,thrust:1},1);run(drift,{steer:.7,thrust:1,handbrake:1},1);
  const slip=(s:MotionState)=>Math.abs(Math.atan2(sideSpeed(s),forwardSpeed(s)));
  assert.ok(slip(drift)>slip(normal)*2);assert.ok(drift.drifting);
  assert.ok(flightSpeed(drift)<flightSpeed(normal),'drift costs energy');
  const before=flightSpeed(drift);run(drift,{},.4);
  assert.ok(drift.grip>.99&&!drift.drifting);assert.ok(flightSpeed(drift)<=before);
});
test('reverse steering follows car behavior on Aster and hull steering in space',()=>{
  const planet=state(),space=state();setVelocity(planet,-6);setVelocity(space,-6);
  run(planet,{steer:1},.25);run(space,{steer:1},.25,true);
  assert.ok(planet.heading<0&&space.heading>0);
});
test('thrusters reflect physical corrections, with silent coasting and appropriate yaw pairs',()=>{
  const s=state();setVelocity(s,20);run(s,{},.1,true);
  assert.equal(thrusterLevels(s.forces).exhaust_left,0);
  run(s,{brake:1},.1,true);assert.ok(thrusterLevels(s.forces).reverse_left>0);
  const right=thrusterLevels({forward:0,side:8,yaw:0});
  assert.ok(right.side_left_front>0&&right.side_left_aft>0);assert.equal(right.side_right_front,0);
  const yaw=thrusterLevels({forward:0,side:0,yaw:5});
  assert.ok(yaw.side_left_front>0&&yaw.side_right_aft>0);assert.equal(yaw.side_left_aft,0);
  const opposite=thrusterLevels({forward:0,side:0,yaw:-5});
  assert.ok(opposite.side_right_front>0&&opposite.side_left_aft>0);
});
