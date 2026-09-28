import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldShowTouch, stickVector, touchFlightInput } from './touch-controls';

test('radial dead zone suppresses thumb drift and clamps diagonal travel',()=>{
  assert.deepEqual(stickVector(.1,.1),{x:0,y:0});
  assert.deepEqual(stickVector(0,0),{x:0,y:0});
  assert.ok(Math.abs(stickVector(.58,0).x-.5)<1e-10);
  const diagonal=stickVector(4,-4);
  assert.ok(Math.abs(Math.hypot(diagonal.x,diagonal.y)-1)<1e-10);
  assert.ok(diagonal.x>0&&diagonal.y<0);
});
test('left stick chooses a compass direction and waits to accelerate until aligned',()=>{
  const north=touchFlightInput({x:0,y:-1},{x:0,y:0},0,false);
  assert.equal(north.steer,0);assert.equal(north.thrust,1);assert.equal(north.brake,0);
  const south=touchFlightInput({x:0,y:1},{x:0,y:0},0,false);
  assert.equal(south.steer,1);assert.equal(south.thrust,0);assert.equal(south.brake,0);
  const alignedSouth=touchFlightInput({x:0,y:1},{x:0,y:0},Math.PI,false);
  assert.equal(alignedSouth.steer,0);assert.equal(alignedSouth.thrust,1);
  const turnLeft=touchFlightInput({x:0,y:-1},{x:0,y:0},Math.PI/2,false);
  assert.equal(turnLeft.steer,-1);assert.equal(turnLeft.thrust,0);
  const east=touchFlightInput({x:1,y:0},{x:0,y:0},Math.PI/2,false);
  assert.equal(east.steer,0);assert.equal(east.thrust,1);
  const wrapped=touchFlightInput({x:-.01,y:1},{x:0,y:0},Math.PI-.01,false);
  assert.ok(Math.abs(wrapped.steer)<1,'Heading wrap chooses the short turn');
});
test('reverse is controlled by its own held button, independently of stick direction',()=>{
  const reverse=touchFlightInput({x:0,y:-1},{x:0,y:0},0,true);
  assert.equal(reverse.brake,1);assert.equal(reverse.thrust,0);assert.equal(reverse.steer,0);
  const neutral=touchFlightInput({x:0,y:0},{x:0,y:0},0,true);
  assert.equal(neutral.brake,1);assert.equal(neutral.steer,0);
  const released=touchFlightInput({x:0,y:0},{x:0,y:0},0,false);
  assert.equal(released.brake,0);assert.equal(released.thrust,0);
});
test('right stick aims in all four world directions and releases the mining laser',()=>{
  for(const [x,y,angle] of [[0,-1,0],[1,0,Math.PI/2],[0,1,Math.PI],[-1,0,-Math.PI/2]]){
    const input=touchFlightInput({x:0,y:0},{x,y},0,false);
    assert.equal(input.aim,angle);assert.equal(input.mine,true);
  }
  const released=touchFlightInput({x:0,y:0},{x:0,y:0},0,false);
  assert.equal(released.mine,false);assert.equal(released.aim,null);
});
test('touch controls only appear in active play without keyboard or gamepad use',()=>{
  assert.equal(shouldShowTouch(true,false,false,true),true,'phone during play');
  assert.equal(shouldShowTouch(false,false,false,true),false,'desktop without touch');
  assert.equal(shouldShowTouch(true,true,false,true),false,'keyboard takes over');
  assert.equal(shouldShowTouch(true,false,true,true),false,'connected controller takes over');
  assert.equal(shouldShowTouch(true,false,false,false),false,'no sticks over menus');
});
