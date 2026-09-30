import test from 'node:test';
import assert from 'node:assert/strict';
import {newSculpt,compileSculpt,SculptBuilder} from './sculpt';
import {BUILTIN_DOCUMENTS,cloneDocument,parsePackage,packageLevel,validateDocument} from './level-document';
import {registerLevel} from './levels';
import {contains,sweep} from './collision';


test('Sculpt source creates a closed playable body within both LOD budgets',()=>{
  const source=newSculpt('test-sculpt','slab');source.seed=83;
  const shape=compileSculpt(source);
  assert.equal(shape.contours.length,1);
  assert.ok(shape.high.indices.length/3<40000);
  assert.ok(shape.standard.indices.length/3<12000);

  assert.ok(shape.vertices.length>1000);
});

test('A carved throughway opens in the collision plane only when the ship fits',()=>{
  const source=newSculpt('test-passage','round');source.seed=17;
  for(let pass=0;pass<18;pass++)for(let x=-30;x<=30;x+=3)source.strokes.push({tool:'subtract',center:[x,1,0],radius:10,strength:1,seconds:.2,falloff:.2});
  const doc=cloneDocument(BUILTIN_DOCUMENTS.find(d=>d.id==='belt')!);
  doc.id='sculpt-test-passage';doc.objects=[{id:'passage',assetId:'sculpt-asteroid',x:0,z:0,rotation:0,scale:1,parameters:{sculptId:source.id}}];
  doc.sculpts={[source.id]:source};doc.deposits=[];doc.spawn={x:-48,z:0};doc.base={...doc.base,x:48,z:0};
  assert.equal(validateDocument(doc).filter(i=>i.severity==='error').length,0);
  const world=registerLevel(doc),rock=world.solids[0];
  assert.ok(world.solids.length===1);
  assert.equal(contains(rock,{x:0,z:0},4.5),false);
  assert.equal(sweep({x:-48,z:0},{x:48,z:0},world.solids,4.5),null);
  const narrow=structuredClone(source);narrow.strokes.forEach(p=>p.radius=3.5);doc.sculpts[source.id]=narrow;
  const blocked=registerLevel(doc);
  assert.ok(contains(blocked.solids[0],{x:0,z:0},4.5));
});

test('A sculpted level exports independently of an optional template library',()=>{
  const source=newSculpt('local-form','mass');source.seed=809;
  source.strokes.push({tool:'paint',center:[12,4,6],radius:7,strength:.6,layer:'weathered'});
  const doc=cloneDocument(BUILTIN_DOCUMENTS.find(d=>d.id==='belt')!);doc.id='sculpt-local-test';
  doc.objects.push({id:'local-rock',assetId:'sculpt-asteroid',x:-10,z:-10,rotation:0,scale:1,parameters:{sculptId:source.id}});
  doc.sculpts={...doc.sculpts,[source.id]:source};
  const imported=parsePackage(JSON.stringify(packageLevel(doc)));
  assert.deepEqual(imported.level.sculpts,doc.sculpts);
  const copy=structuredClone(imported.level);copy.sculpts![source.id].strokes.push({tool:'add',center:[0,0,0],radius:5,strength:.8});
  assert.equal(imported.level.sculpts![source.id].strokes.length,1);
});

test('Incremental chunk rebuilding matches a fresh build across seams, paint and undo',()=>{
  const source=newSculpt('incremental','round');source.seed=910;
  const builder=new SculptBuilder(source);
  source.strokes.push({tool:'add',center:[17,5,1],radius:7,strength:.8,falloff:.7});
  source.strokes.push({tool:'subtract',center:[-17,8,-2],radius:6,strength:.9,falloff:.2});
  source.strokes.push({tool:'paint',center:[17,5,1],radius:9,strength:.6,falloff:.8,layer:'weathered'});
  assert.deepEqual(builder.update(source),compileSculpt(source));
  source.strokes.pop();
  assert.deepEqual(builder.update(source),compileSculpt(source));
});

test('Grab, smooth, flatten and surface paint survive incremental rebuilds',()=>{
  const source=newSculpt('all-brushes','round');source.seed=418;
  const builder=new SculptBuilder(source);
  for(const stroke of [
    {tool:'add' as const,center:[20,3,0] as [number,number,number],radius:7,strength:.9,falloff:.6},
    {tool:'grab' as const,center:[20,3,0] as [number,number,number],radius:9,strength:.7,delta:[3,2,0] as [number,number,number]},
    {tool:'smooth' as const,center:[20,3,0] as [number,number,number],radius:8,strength:.8},
    {tool:'flatten' as const,center:[20,3,0] as [number,number,number],radius:9,strength:.5,normal:[1,0,0] as [number,number,number]},
    {tool:'paint' as const,center:[20,3,0] as [number,number,number],radius:10,strength:.8,layer:'color' as const},
  ]){source.strokes.push(stroke);assert.deepEqual(builder.update(source),compileSculpt(source));}
  assert.ok(builder.compile().high.paint.some((v,i)=>i%4===3&&v>0));
});

test('Removing a full sheet separates one volume into multiple playable contours',()=>{
  const source=newSculpt('two-islands','round');source.seed=107;
  for(let pass=0;pass<12;pass++)for(let y=-30;y<=30;y+=5)for(let z=-30;z<=30;z+=5)
    source.strokes.push({tool:'subtract',center:[0,y,z],radius:8,strength:1,falloff:.2,seconds:.25});
  const compiled=compileSculpt(source);
  assert.ok(compiled.contours.length>=2);
  assert.ok(compiled.high.indices.length/3<40000&&compiled.standard.indices.length/3<12000);
});

test('stationary airbrush changes volume on every tick and preview patches are local',()=>{
  const source=newSculpt('continuous','block');source.seed=311;const builder=new SculptBuilder(source);
  const stroke={tool:'subtract' as const,center:[23,0,0] as [number,number,number],radius:7,strength:1,seconds:.1};
  const initial=builder.compile(),changed=builder.append([stroke]);assert.ok(Object.keys(changed).length<Object.keys(builder.preview()).length);
  const once=builder.compile();builder.append([stroke]);const twice=builder.compile();
  assert.notDeepEqual(initial.high.positions,once.high.positions);assert.notDeepEqual(once.high.positions,twice.high.positions);
  source.strokes.push(stroke,stroke);assert.deepEqual(builder.finish(),compileSculpt(source));
});
