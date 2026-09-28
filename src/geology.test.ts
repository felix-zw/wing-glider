import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bedrockDatum, getLevelWorld, groundHeight } from './levels';
import { cliffFacing, cliffUplift } from './geology';
import { surfacePoint } from './resources';

test('cliffs rise from wide outer slopes while canyon centres remain low', () => {
  const world=getLevelWorld('aster');
  const isolatedRidges={...world,structures:world.solids};
  for(const cliff of world.solids) if(cliff.kind==='cliff') {
    const sign=cliffFacing(cliff), vertical=cliff.halfX<cliff.halfZ;
    const point=(across:number)=>({x:cliff.x+(vertical?across*sign:0),z:cliff.z+(vertical?0:across*sign)});
    const back=point(-25), floor=point(15), outer=point(-57);
    assert.ok(groundHeight(isolatedRidges,back.x,back.z)-bedrockDatum(isolatedRidges,back.x,back.z)>8,`${cliff.id}: missing outer ridge`);
    assert.ok(groundHeight(world,back.x,back.z)>=groundHeight(isolatedRidges,back.x,back.z),`${cliff.id}: joining a hill lowered the ridge`);
    assert.ok(cliffUplift(cliff,floor.x,floor.z)<.01,`${cliff.id}: canyon floor filled`);
    assert.equal(cliffUplift(cliff,outer.x,outer.z),0,`${cliff.id}: outer slope must rejoin the terrain`);
  }
  assert.equal(groundHeight(world,100,90),bedrockDatum(world,100,90),'the existing higher hill must not have another ridge stacked on it');
});

test('new relief preserves protected floors, base placement and the space flight plane', () => {
  const aster=getLevelWorld('aster'), belt=getLevelWorld('belt');
  for(const s of aster.shelters) for(let i=0;i<16;i++) {
    const a=i*Math.PI/8;
    assert.equal(groundHeight(aster,s.x+Math.cos(a)*11.9,s.z+Math.sin(a)*11.9),1.5);
  }
  for(let x=-200;x<=200;x+=20) for(let z=-200;z<=200;z+=20) {
    assert.equal(groundHeight(belt,x,z),0);
    const h=groundHeight(aster,x,z);
    assert.ok(Number.isFinite(h)); assert.ok(h>=bedrockDatum(aster,x,z)-1e-8);
  }
});

test('ridge joins are continuous and wall mining points stay above the local floor', () => {
  const world=getLevelWorld('aster');
  for(const cliff of world.solids) if(cliff.kind==='cliff') {
    for(let x=cliff.x-70;x<cliff.x+70;x+=3) for(let z=cliff.z-60;z<cliff.z+60;z+=3) {
      const h=groundHeight(world,x,z);
      assert.ok(Math.abs(groundHeight(world,x+.001,z)-h)<.008,`${cliff.id}: X discontinuity`);
      assert.ok(Math.abs(groundHeight(world,x,z+.001)-h)<.008,`${cliff.id}: Z discontinuity`);
    }
  }
  for(const d of world.deposits.filter(d=>d.surface?.kind==='wall')) for(const fraction of [-.5,-.25,0,.25,.5]) {
    const p=surfacePoint(d,fraction*d.surface!.width,world);
    assert.ok(Math.abs(p.y-groundHeight(world,p.x,p.z)-.7)<1e-7,`${d.id}: buried interaction point`);
  }
});
