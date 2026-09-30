import test from 'node:test';
import assert from 'node:assert/strict';
import {oreMass,sprayOre,resolveOreCell,validOreLayer,pruneEmptyOreCells,type OreLayer} from './ore-paint';
import {BUILTIN_DOCUMENTS,cloneDocument,packageLevel,parsePackage} from './level-document';
import {compileLevel} from './levels';
import {createResourceState,advanceResources,findTarget} from './resources';
import {rayRock} from './rock-surface';

test('stationary spray accumulates bounded thickness and area determines physical mass',()=>{
  const paint:OreLayer={version:1,cells:[]},samples=[{position:[1,2,3] as [number,number,number],normal:[1,0,0] as [number,number,number],weight:1}];
  sprayOre(paint,samples,.1,1,.5);const before=oreMass(paint);sprayOre(paint,samples,.1,1,.5);
  assert.equal(paint.cells.length,1);assert.ok(oreMass(paint)>before);
  for(let i=0;i<20;i++)sprayOre(paint,samples,.1,1,.5);
  assert.equal(paint.cells[0].thickness,.5);assert.equal(oreMass(paint,2),oreMass(paint)*8);
});
test('old space packages are rejected clearly while old planet documents remain readable',()=>{
  const space:any=packageLevel(BUILTIN_DOCUMENTS[1]);space.version=1;space.level.version=1;
  assert.throws(()=>parsePackage(JSON.stringify(space)),/alte Modellformat/);
  const planet:any=packageLevel(BUILTIN_DOCUMENTS[0]);planet.version=1;planet.level.version=1;
  assert.equal(parsePackage(JSON.stringify(planet)).level.version,2);
});
test('zero falloff at the spray boundary never creates empty cells or invalidates a layer',()=>{
  const paint:OreLayer={version:1,cells:[]},normal:[number,number,number]=[0,1,0];
  sprayOre(paint,[{position:[0,0,0],normal,weight:1},{position:[14.5,0,0],normal,weight:0}],.1,1,1);
  assert.equal(paint.cells.length,1);assert.ok(validOreLayer(paint));
  const before=structuredClone(paint);
  for(const weight of [0,-1,NaN,Infinity])sprayOre(paint,[{position:[10,0,0],normal,weight}],.1,1,1);
  sprayOre(paint,[{position:[10,0,0],normal,weight:1}],0,1,1);
  sprayOre(paint,[{position:[10,0,0],normal,weight:1}],.1,0,1);
  sprayOre(paint,[{position:[10,0,0],normal,weight:1}],.1,1,0);
  assert.deepEqual(paint,before);
  sprayOre(paint,[{position:[0,0,0],normal,weight:1}],.1,1,.1);
  assert.deepEqual(paint,before,'lowering the spray ceiling must not remove deposited ore');
});
test('saved brush-edge cells are repaired without losing ore mass or hiding other errors',()=>{
  const doc=cloneDocument(BUILTIN_DOCUMENTS[1]),ore=doc.deposits[0],paint=ore.paint!,before=structuredClone(paint);
  paint.cells.push({...structuredClone(paint.cells[0]),thickness:0});
  const amount=oreMass(paint);assert.equal(validOreLayer(paint),false);
  const restored=parsePackage(JSON.stringify(packageLevel(doc)));
  assert.deepEqual(restored.level.deposits[0].paint,before);assert.equal(oreMass(restored.level.deposits[0].paint!),amount);
  pruneEmptyOreCells(paint);assert.deepEqual(paint,before);
  paint.cells[0].thickness=-.1;pruneEmptyOreCells(paint);
  assert.equal(validOreLayer(paint),false);assert.throws(()=>parsePackage(JSON.stringify(packageLevel(doc))),/Erzschicht/);
});
test('mining changes only the hit region, conserves mass and never changes the draft',()=>{
  const doc=cloneDocument(BUILTIN_DOCUMENTS[1]),world=compileLevel(doc),state=createResourceState(world),d=state.deposits[0],cell=d.surface!.cells![7];
  const n=cell.normal,actor={x:cell.x+n.x*12,z:cell.z+n.z*12,y:cell.y+n.y*12,turret:Math.atan2(-n.x,n.z),speed:0};
  const hit=findTarget([d],actor,world);assert.ok(hit?.cell);
  state.deposits=[d];const before=d.surface!.cells!.map(c=>c.mass),events:number[]=[];
  advanceResources(state,actor,true,.4,e=>{if(e.kind==='mined')events.push(e.amount);},world);
  assert.ok(d.surface!.cells!.filter((c,i)=>c.mass!==before[i]).length===1);
  const pending=d.extracted??0,fragments=state.fragments.reduce((n,f)=>n+(f.amount??1),0);
  assert.ok(Math.abs(d.remaining+pending+fragments-12)<1e-8);
  assert.equal(doc.deposits[0].amount,12);assert.equal(world.deposits[0].surface!.cells![0].mass,world.deposits[0].surface!.cells![0].initialMass);
});
test('an erased support never attaches its ore to a distant opposing face',()=>{
  const world=compileLevel(BUILTIN_DOCUMENTS[1]);
  const cell=resolveOreCell(world.solids[0],{position:[0,0,0],normal:[1,0,0],radius:1,thickness:1});assert.equal(cell.valid,false);
});

test('an older immutable world retains its own query surface after a new form revision',()=>{
  const doc=cloneDocument(BUILTIN_DOCUMENTS[1]);doc.id='query-revision-check';
  const old=compileLevel(doc),host=old.solids[0],origin={x:host.x+60,y:3.2,z:host.z},direction={x:-1,y:0,z:0};
  const before=rayRock(host,origin,direction)!;assert.ok(before);
  doc.sculpts![String(doc.objects[0].parameters.sculptId)].shape='round';const next=compileLevel(doc);
  assert.deepEqual(rayRock(host,origin,direction),before);
  assert.notEqual(rayRock(next.solids[0],origin,direction)?.distance,before.distance);
});

test('partial fragments respect cargo capacity without losing fractional ore',()=>{
  const world=compileLevel(BUILTIN_DOCUMENTS[1]),state=createResourceState(world),actor={...world.spawn,turret:0,speed:0};
  state.cargo.ferrite=29.8;state.fragments=[{id:0,resource:'copper',amount:.7,x:actor.x,z:actor.z,age:2,vx:0,vz:0}];
  advanceResources(state,actor,false,.1,()=>{},world);
  assert.ok(Math.abs(state.cargo.copper-.2)<1e-8);assert.ok(Math.abs(state.fragments[0].amount!-.5)<1e-8);
});

test('whole mineral fragments stay exactly whole across floating point extraction steps',()=>{
  const world=compileLevel(BUILTIN_DOCUMENTS[1]),state=createResourceState(world),d=state.deposits[0];state.deposits=[d];
  const amounts:number[]=[];
  for(let i=0;i<1600&&d.remaining>0;i++){
    const c=d.surface!.cells!.find(c=>c.mass>1e-8)!;if(!c)break;
    const n=c.normal,actor={x:c.x+n.x*12,z:c.z+n.z*12,y:c.y+n.y*12,turret:Math.atan2(-n.x,n.z),speed:0};
    advanceResources(state,actor,true,1/120,e=>{if(e.kind==='mined')amounts.push(e.amount);},world);
  }
  assert.equal(d.remaining,0);assert.equal(amounts.length,12);assert.ok(amounts.every(n=>n===1));
});
