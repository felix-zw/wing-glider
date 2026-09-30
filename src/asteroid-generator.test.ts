import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_GENERATOR,generateForm,generateOres,generateSurfaceGlow,generateCore} from './asteroid-generator';
import {newSculpt,compileSculpt,SculptBuilder,validSculpt,SCULPT_SHAPES} from './sculpt';
import {registerSculpt,getSculpt} from './sculpt-runtime';
import {oreMass,validOreLayer,resolveOreCell} from './ore-paint';
import {newRockGlow,newSkyBody,lightingErrors,themeLighting} from './lighting';
import {BUILTIN_DOCUMENTS,cloneDocument,packageLevel,parsePackage,validateDocument} from './level-document';
import {THEMES} from './themes';
import {EditorHistory} from './editor-model';

test('seeded variants are reproducible, bounded and preserve independently authored appearance',()=>{
  const s=newSculpt('generated','block');s.glow=newRockGlow();s.strokes=[{tool:'add',center:[20,0,0],radius:4,strength:.5},{tool:'paint',layer:'weathered',center:[0,0,20],radius:6,strength:.8}];
  for(let seed=0;seed<100;seed++){const a=generateForm(s,seed,DEFAULT_GENERATOR);assert.ok(validSculpt(a),'valid seed '+seed);assert.deepEqual(a,generateForm(s,seed,DEFAULT_GENERATOR));assert.deepEqual(a.material,s.material);assert.deepEqual(a.glow,s.glow);assert.deepEqual(a.strokes,[s.strokes[1]]);}
  assert.notDeepEqual(generateForm(s,12,DEFAULT_GENERATOR).variation,generateForm(s,13,DEFAULT_GENERATOR).variation);
  assert.equal(s.strokes.length,2);
});
test('all generated shape families retain closed surfaces and both triangle limits',()=>{
  for(const [i,shape] of (Object.keys(SCULPT_SHAPES) as (keyof typeof SCULPT_SHAPES)[]).entries()){
    const source=generateForm(newSculpt('shape-'+shape,shape),7113+i,{...DEFAULT_GENERATOR,shape}),c=compileSculpt(source);
    assert.ok(c.high.indices.length/3<=40000&&c.standard.indices.length/3<=12000);assert.ok(c.high.indices.length>1000);
    assert.ok(c.high.positions.every(p=>Math.abs(p)<35.5),'surface stays inside its volume');
    const edges=new Map<string,number>(),key=(id:number)=>c.high.positions.slice(id*3,id*3+3).map(v=>v.toFixed(9)).join(',');
    for(let j=0;j<c.high.indices.length;j+=3)for(let k=0;k<3;k++){const a=key(c.high.indices[j+k]),b=key(c.high.indices[j+(k+1)%3]),edge=a<b?a+'|'+b:b+'|'+a;edges.set(edge,(edges.get(edge)??0)+1);}
    assert.ok([...edges.values()].every(n=>n===2),'watertight '+shape);
  }
});
test('variation changes invalidate the runtime cache and incremental builder',()=>{
  const a=generateForm(newSculpt('cache-test'),87,DEFAULT_GENERATOR),b=generateForm(a,88,DEFAULT_GENERATOR);b.seed=a.seed;
  registerSculpt('generator-cache','object',a);const first=getSculpt('generator-cache','object');registerSculpt('generator-cache','object',b);assert.notStrictEqual(getSculpt('generator-cache','object'),first);
  assert.deepEqual(new SculptBuilder(a).update(b),compileSculpt(b));
});
test('generated ores follow actual surfaces, remain mineable and conserve authored mass',()=>{
  const source=generateForm(newSculpt('ore-host'),411,{...DEFAULT_GENERATOR,shape:'split'}),compiled=compileSculpt(source),scale=1.25;
  const asset=registerSculpt('generator-ore','host',source,scale),host={kind:'asteroid' as const,id:'host',x:40,z:-20,rotation:1.3,scale,radius:36,height:72,query:asset};
  const ores=generateOres(compiled,scale,20,DEFAULT_GENERATOR);
  assert.deepEqual(ores,generateOres(compiled,scale,20,DEFAULT_GENERATOR));assert.equal(new Set(ores.map(o=>o.resource)).size,3);
  for(const ore of ores){assert.ok(validOreLayer(ore.paint));assert.equal(ore.amount,oreMass(ore.paint,scale));const cells=ore.paint.cells.map(c=>resolveOreCell(host,c));assert.ok(cells.every(c=>c.valid),'all generated anchors supported');assert.ok(cells.every(c=>Math.abs(c.y-2.4)<6.5));assert.ok(Math.abs(cells.reduce((n,c)=>n+c.mass,0)-ore.amount)<1e-8);}
  const ferrite=generateOres(compiled,scale,20,{...DEFAULT_GENERATOR,resource:'ferrite'});assert.ok(ferrite.every(o=>o.resource==='ferrite'));
});
test('glow and core generators change their own channels without reshaping the host',()=>{
  const source=generateForm(newSculpt('glow-host'),115,DEFAULT_GENERATOR),compiled=compileSculpt(source);source.glow=newRockGlow();source.glow.core.enabled=true;
  source.strokes.push({tool:'paint',layer:'weathered',center:[0,0,20],radius:8,strength:1});
  const painted=generateSurfaceGlow(source,compiled,37,DEFAULT_GENERATOR);assert.deepEqual(painted.glow!.core,source.glow.core);assert.deepEqual(painted.strokes.filter(p=>p.layer!=='glow'),source.strokes);
  const core=generateCore(painted,compiled,38,DEFAULT_GENERATOR);assert.deepEqual(core.strokes,painted.strokes);assert.equal(core.glow!.color,painted.glow!.color);assert.ok(validSculpt(core));
  assert.deepEqual(compileSculpt(core).high.positions,compiled.high.positions);assert.deepEqual(generateSurfaceGlow(source,compiled,37,DEFAULT_GENERATOR),painted);
});
test('generated level data exports independently and all editor changes share undo/redo',()=>{
  const doc=cloneDocument(BUILTIN_DOCUMENTS[1]);doc.id='generator-roundtrip';doc.lighting=themeLighting(THEMES.belt);const planet=newSkyBody('planet-distance','planet');planet.distance=4600;doc.lighting.bodies.push(planet);
  const object=doc.objects[0],id=String(object.parameters.sculptId),history=new EditorHistory({level:doc,theme:structuredClone(THEMES.belt),selection:object.id}),before=structuredClone(history.current);
  history.change(s=>{s.level.sculpts![id]=generateForm(s.level.sculpts![id],522,DEFAULT_GENERATOR);s.level.deposits=s.level.deposits.filter(d=>d.structureId!==object.id);});
  const generated=structuredClone(history.current);assert.equal(validateDocument(history.current.level).filter(e=>e.severity==='error').length,0);
  assert.deepEqual(parsePackage(JSON.stringify(packageLevel(history.current.level))).level,history.current.level);
  assert.ok(history.undo());assert.deepEqual(history.current,before);assert.ok(history.redo());assert.deepEqual(history.current,generated);
  history.change(s=>s.level.lighting!.bodies.at(-1)!.distance=9000);assert.ok(history.undo());assert.equal(history.current.level.lighting!.bodies.at(-1)!.distance,4600);assert.ok(history.redo());assert.equal(history.current.level.lighting!.bodies.at(-1)!.distance,9000);
  planet.distance=Infinity;assert.ok(lightingErrors(doc.lighting).length);delete planet.distance;assert.deepEqual(lightingErrors(doc.lighting),[]);
});
