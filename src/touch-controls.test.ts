import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldShowTouch, stickVector, touchFlightInput, TouchThrottle } from './touch-controls';

test('radial dead zone suppresses thumb drift and clamps diagonal travel',()=>{
  assert.deepEqual(stickVector(.1,.1),{x:0,y:0});
  assert.deepEqual(stickVector(0,0),{x:0,y:0});
  assert.ok(Math.abs(stickVector(.58,0).x-.5)<1e-10);
  const diagonal=stickVector(4,-4);
  assert.ok(Math.abs(Math.hypot(diagonal.x,diagonal.y)-1)<1e-10);
  assert.ok(diagonal.x>0&&diagonal.y<0);
});
test('left stick steers relatively while gas, brake and handbrake are independent',()=>{
  const idle=touchFlightInput({x:0,y:-1},{x:0,y:0},0,0,0);
  assert.equal(idle.thrust,0);assert.equal(idle.steer,0);
  const driving=touchFlightInput({x:-.7,y:.7},{x:0,y:0},1,0,1);
  assert.equal(driving.steer,-.7);assert.equal(driving.thrust,1);assert.equal(driving.handbrake,1);
  const braking=touchFlightInput({x:.5,y:0},{x:0,y:0},1,1,0);
  assert.equal(braking.thrust,0);assert.equal(braking.brake,1);assert.equal(braking.steer,.5);
});
test('right stick aims in all four world directions and releases the mining laser',()=>{
  for(const [x,y,angle] of [[0,-1,0],[1,0,Math.PI/2],[0,1,Math.PI],[-1,0,-Math.PI/2]]){
    const input=touchFlightInput({x:0,y:0},{x,y},0,0,0);
    assert.equal(input.aim,angle);assert.equal(input.mine,true);
  }
  const released=touchFlightInput({x:0,y:0},{x:0,y:0},0,0,0);
  assert.equal(released.mine,false);assert.equal(released.aim,null);
});
test('gas holds normally, double-taps latch, and tapping a latch releases it',()=>{
  const gas=new TouchThrottle();gas.down(0);assert.ok(gas.held);gas.up(800);
  assert.ok(!gas.held&&!gas.latched);
  gas.down(1000);gas.up(1050);gas.down(1200);gas.up(1250);
  assert.ok(gas.latched&&!gas.held);
  gas.down(1700);assert.ok(!gas.latched&&!gas.held);gas.up(1750);
  gas.down(2000);gas.up(2050);gas.down(2400);gas.up(2450);
  assert.ok(!gas.latched,'separated taps do not latch');
  gas.down(2500);gas.up(2550);assert.ok(gas.latched);
  gas.clear();assert.ok(!gas.latched&&!gas.held);
  gas.down(2600);gas.up(2650);assert.ok(!gas.latched,'reset also clears the tap window');
});
test('touch controls only appear in active play without keyboard or gamepad use',()=>{
  assert.equal(shouldShowTouch(true,false,false,true),true);
  assert.equal(shouldShowTouch(false,false,false,true),false);
  assert.equal(shouldShowTouch(true,true,false,true),false);
  assert.equal(shouldShowTouch(true,false,true,true),false);
  assert.equal(shouldShowTouch(true,false,false,false),false);
});
