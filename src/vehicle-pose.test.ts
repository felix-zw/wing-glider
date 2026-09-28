import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Euler, Vector3 } from 'three';
import { getLevelWorld, groundHeight } from './levels';
import { HULL, hullPoint, terrainAttitude, turretYaw, vehicleLaserOrigin, vehiclePose, type VehiclePose } from './vehicle-pose';

test('vehicle pitch and roll align to uphill, downhill and lateral slopes at any heading',()=>{
  const height=(x:number,z:number)=>x*.4-z*.6;
  for(const heading of [0,.6,Math.PI/2,Math.PI,4.1]) {
    const {pitch,roll}=terrainAttitude(height,0,0,heading);
    const normal=new Vector3(0,1,0).applyEuler(new Euler(pitch,-heading,roll,'YXZ'));
    assert.ok(normal.distanceTo(new Vector3(-.4,1,.6).normalize())<1e-10);
  }
  assert.ok(terrainAttitude(height,0,0,0).pitch>0);
  assert.ok(terrainAttitude(height,0,0,Math.PI).pitch<0);
  assert.deepEqual(terrainAttitude(()=>0,0,0,2),{pitch:0,roll:0});
});

test('clearance coordinates match the actual Three.js hull transform',()=>{
  for(const heading of [0,.7,3]) for(const pitch of [-.8,.4]) for(const roll of [-.7,.6]) {
    const p=hullPoint(2.9,-.5,-4.3,heading,pitch,roll);
    const expected=new Vector3(2.9,-.5,-4.3).applyEuler(new Euler(pitch,-heading,roll,'YXZ'));
    assert.ok(expected.distanceTo(new Vector3(p.x,p.y,p.z))<1e-10);
  }
});

test('turret barrel keeps its world bearing on pitched and rolled hulls',()=>{
  for(const heading of [0,.8,3]) for(const pitch of [-.82,.6]) for(const roll of [-.72,.4]) for(const bearing of [0,.7,2.4]) {
    const yaw=turretYaw(heading,pitch,roll,bearing);
    const barrel=new Vector3(0,0,-1).applyEuler(new Euler(0,yaw,0)).applyEuler(new Euler(pitch,-heading,roll,'YXZ'));
    const error=Math.atan2(Math.sin(Math.atan2(barrel.x,-barrel.z)-bearing),Math.cos(Math.atan2(barrel.x,-barrel.z)-bearing));
    assert.ok(Math.abs(error)<1e-10);
    const origin=vehicleLaserOrigin({height:20,pitch,roll},{x:8,z:12,heading,turret:bearing});
    const socket=new Vector3(0,.28,-.99).applyEuler(new Euler(0,yaw,0)).add(new Vector3(0,.8,.72))
      .applyEuler(new Euler(pitch,-heading,roll,'YXZ')).add(new Vector3(8,20,12));
    assert.ok(socket.distanceTo(new Vector3(origin.x,origin.y,origin.z))<1e-10);
  }
});

test('smoothed vehicle body clears Aster crests, shelter edges and cliff slopes',()=>{
  const world=getLevelWorld('aster'), height=(x:number,z:number)=>groundHeight(world,x,z);
  // Traverse both axes at speed, crossing the steep joins introduced by ridges.
  for(const fixed of [-145,-103,-55,-26,0,30,65,100,140]) for(const axis of [0,1]) {
    let pose:VehiclePose|null=null;
    for(let along=-200;along<=200;along+=1.25) {
      const x=axis?fixed:along,z=axis?along:fixed,heading=axis?Math.PI:Math.PI/2;
      pose=vehiclePose(height,{x,z,heading,hover:2.4,bank:.045},pose,1/30);
      // Dense, independent interior samples catch penetration between the 25 support points.
      for(let r=0;r<=8;r++) for(let c=0;c<=8;c++) {
        const p=hullPoint(-HULL.halfWidth+c*HULL.halfWidth/4,HULL.bottom,HULL.front+r*(HULL.rear-HULL.front)/8,heading,pose.pitch,pose.roll);
        assert.ok(pose.height+p.y-height(x+p.x,z+p.z)>.18,`hull intersects terrain at ${x}/${z}`);
      }
    }
  }
});
