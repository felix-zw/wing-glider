import test from 'node:test';
import assert from 'node:assert/strict';
import { ATLAS, atlasPlacement, atlasPoint, solveAtlasGround, solveLeg, supportFoot, atlasDriveSurface } from './atlas-rig';
import { deploymentActive, deploymentFrame } from './deployment';
import { createState, advance, neutralInput } from './simulation';
import { getLevelWorld, groundHeight, compileLevel } from './levels';
import { BUILTIN_DOCUMENTS } from './level-document';
import { vehiclePose, hullPoint, HULL } from './vehicle-pose';
import { contains } from './collision';

test('ATLAS solves level ground and independently follows compound slopes',()=>{
  for(const height of [()=>0,(x:number,z:number)=>x*.12+z*.08,(x:number,z:number)=>2+Math.sin(x*.15)+Math.cos(z*.08)]) {
    const p=solveAtlasGround(height,{x:0,z:0,yaw:.4});
    assert.ok(p.valid);
    for(const foot of p.feet) {
      assert.ok(Math.abs(Math.hypot(foot.knee.x-foot.hip.x,foot.knee.y-foot.hip.y)-ATLAS.upperLength)<1e-8);
      assert.ok(Math.abs(Math.hypot(foot.knee.x-foot.ankle.x,foot.knee.y-foot.ankle.y-.5)-foot.lowerLength)<1e-8);
      let closest=Infinity;
      for(let row=0;row<=6;row++)for(let col=0;col<=4;col++) {
        const r=hullPoint((col/2-1)*ATLAS.padHalfX,0,(row/3-1)*ATLAS.padHalfZ,0,foot.pitch,foot.roll);
        const w=atlasPoint(p,foot.ankle.x+r.x,foot.ankle.y+r.y,foot.ankle.z+r.z);
        const clearance=w.y-height(w.x,w.z);assert.ok(clearance>=.02499);closest=Math.min(closest,clearance);
      }
      assert.ok(closest<.026,'each foot has a real support point');
    }
  }
  const p=solveAtlasGround((x,z)=>x*.15+z*.1,{x:0,z:0,yaw:0});
  assert.ok(Math.max(...p.feet.map(f=>f.ankle.y))-Math.min(...p.feet.map(f=>f.ankle.y))>3);
});

test('unreachable feet and excessive slopes are rejected without non-finite transforms',()=>{
  assert.equal(solveLeg(1,0,{x:9.5,y:-40,z:0}).valid,false);
  const p=solveAtlasGround((x,z)=>z*2,{x:0,z:0,yaw:0});assert.equal(p.valid,false);
  assert.ok(Number.isFinite(p.height));
  const f=supportFoot(x=>x*10,0,0,0);assert.ok(Math.abs(f.roll)<=.42);
});

for(const id of ['aster','belt']) {
  test(`${id}: valid placement and continuous supported deployment`,()=>{
    const world=getLevelWorld(id),p=atlasPlacement(world);assert.ok(p.valid,p.reason);
    for(const t of [0,1,2,2.5]) {
      const offset=deploymentFrame(world,t).shipOffset;
      for(let z=ATLAS.front;z<=ATLAS.rear;z+=2)for(let x=-ATLAS.halfWidth;x<=ATLAS.halfWidth;x+=2.6) {
        const q=atlasPoint(p,x,0,z);q.x+=offset.x;q.z+=offset.z;
        assert.ok(!world.solids.some(s=>contains(s,q,1)),`ATLAS approach obstacle at ${t}s`);
      }
    }
    const end=deploymentFrame(world,8).player;
    assert.ok(Math.abs(Math.hypot(end.x-world.base.x,end.z-world.base.z)-8)<1e-7);
    for(let t=4;t<=8;t+=.05) {
      const f=deploymentFrame(world,t).player;
      if(id==='aster')for(let row=0;row<=4;row++)for(let col=0;col<=4;col++) {
        const point=hullPoint(-HULL.halfWidth+col*HULL.halfWidth/2,HULL.bottom,HULL.front+row*(HULL.rear-HULL.front)/4,f.heading,f.pitch,f.roll);
        const surface=atlasDriveSurface(world,p,f.x+point.x,f.z+point.z);
        assert.ok(f.height+point.y>=surface+.69,`speeder clearance t=${t}`);
      }
    }
    if(id==='aster') {
      const normal=vehiclePose((x,z)=>groundHeight(world,x,z),{...end,hover:2.4,bank:0},null,0);
      assert.ok(Math.abs(normal.height-end.height)<1e-8);
    } else assert.equal(Math.hypot(end.vx,end.vz),4);
    const before=deploymentFrame(world,7.999).player;assert.ok(Math.abs(before.height-end.height)<.02);
  });
  test(`${id}: arrival consumes no mission time or input; restart and zero time are deterministic`,()=>{
    const a=createState(id,{arrival:true}),initial=structuredClone(a),input={...neutralInput(),thrust:1,steer:1,mine:true,unloadPressed:true};
    advance(a,input,0);assert.deepEqual(a,initial);
    advance(a,input,7.5);assert.equal(a.elapsed,0);assert.equal(a.phaseTime,0);assert.equal(a.distance,0);assert.equal(a.health,100);
    assert.deepEqual(a.resources,initial.resources);assert.deepEqual(a.mission,initial.mission);assert.deepEqual(a.environment,initial.environment);
    advance(a,input,.5);assert.equal(deploymentActive(a.deployment),false);assert.equal(a.elapsed,0);assert.equal(a.yawRate,0);
    assert.deepEqual(createState(id,{arrival:true}),initial);
    const normal=createState(id);assert.equal(normal.deployment,null);
  });
  test(`${id}: deployment agrees at 30 and 144 FPS including the handoff`,()=>{
    const a=createState(id,{arrival:true}),b=createState(id,{arrival:true});
    for(let i=0;i<240;i++)advance(a,neutralInput(),1/30);
    for(let i=0;i<1152;i++)advance(b,neutralInput(),1/144);
    assert.equal(a.deployment?.phase,'ready');assert.equal(b.deployment?.phase,'ready');
    for(const key of ['x','z','heading','vx','vz','elapsed'] as const)assert.ok(Math.abs(a[key]-b[key])<1e-8,key);
  });
}
test('custom base positions get an independent cached rig; blocked bases fail validation',()=>{
  const doc=structuredClone(BUILTIN_DOCUMENTS.find(d=>d.environment==='space')!);doc.base.x=0;doc.base.z=0;
  doc.objects=[];doc.deposits=[];const world=compileLevel(doc),p=atlasPlacement(world);assert.ok(p.valid);assert.equal(p,atlasPlacement(world));
  doc.base.x=doc.bounds;doc.base.z=doc.bounds;
  assert.equal(atlasPlacement(compileLevel(doc)).valid,false);
});
