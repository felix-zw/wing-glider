import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BUILTIN_DOCUMENTS,cloneDocument,packageLevel,parsePackage} from './level-document';
import {THEMES} from './themes';
import {compileLevel,registerLevel} from './levels';
import {EditorHistory,inspectLevel} from './editor-model';
import {createState,isProtected,advance,neutralInput,nearestShelter} from './simulation';
import {selectDeposit} from './resources';
import {rayRock} from './rock-surface';
import {oreMass,resolveOreCell} from './ore-paint';
import {contains,sweep} from './collision';
import {shelterRoute} from './navigation';

test('both authored levels have reachable ore and a valid service area',()=>{
  for(const doc of BUILTIN_DOCUMENTS)assert.deepEqual(inspectLevel(doc),[],doc.id);
});
test('JSON exchange preserves level, theme, placements and delivery mission',()=>{
  const doc=cloneDocument(BUILTIN_DOCUMENTS[1]);doc.id='roundtrip';doc.name='<My sector>';doc.base={...doc.base,x:-18,z:-15};
  const pack=parsePackage(JSON.stringify(packageLevel(doc)));assert.deepEqual(pack.level,doc);
  assert.deepEqual(compileLevel(doc).deposits,compileLevel(pack.level).deposits);
  assert.throws(()=>parsePackage('{"version":999}'));
  const invalid=packageLevel(doc);invalid.level.objects[0].assetId='external-script';assert.throws(()=>parsePackage(JSON.stringify(invalid)));
  invalid.level.objects[0].assetId='asteroid-slab';invalid.level.objects[0].scale=-1;assert.throws(()=>parsePackage(JSON.stringify(invalid)));
});

test('imports reject malformed lists, reserved IDs and duplicate ore sectors before compilation',()=>{
  const pack=packageLevel(BUILTIN_DOCUMENTS[1]);
  const invalid=structuredClone(pack);(invalid.level.objects as unknown[])[0]=null;
  assert.throws(()=>parsePackage(JSON.stringify(invalid)),/Objektliste/);
  invalid.level=cloneDocument(pack.level);invalid.level.objects[0].id='spawn';
  assert.throws(()=>parsePackage(JSON.stringify(invalid)),/eindeutig/);
  invalid.level=cloneDocument(pack.level);invalid.level.deposits.push({...invalid.level.deposits[0],id:invalid.level.deposits[0].id});
  assert.throws(()=>parsePackage(JSON.stringify(invalid)),/eindeutig/);
});
test('custom IDs choose physics by environment; ATLAS shield and unloading follow the document',()=>{
  const doc=cloneDocument(BUILTIN_DOCUMENTS[1]);doc.id='custom-space';doc.base={...doc.base,x:-18,z:18};doc.spawn={x:-18,z:18};registerLevel(doc);
  const state=createState(doc.id);assert.equal(state.environment.kind,'space');assert.ok(isProtected(state));assert.ok(!isProtected({x:180,z:180,levelId:doc.id}));
  state.resources.cargo.copper=8;advance(state,{...neutralInput(),unloadPressed:true},.01);assert.equal(state.resources.storage.copper,8);
  const planet=cloneDocument(BUILTIN_DOCUMENTS[0]);planet.id='custom-planet';planet.shelters[4].x=5;registerLevel(planet);
  const p=createState(planet.id);assert.equal(p.environment.kind,'planet');assert.equal(nearestShelter({x:5,z:0,levelId:planet.id}).x,5);
  assert.equal(shelterRoute({x:5,z:0,heading:0,levelId:planet.id}).shelter.x,5);
});
test('a new revision resets compiled data without sharing a mutable expedition',()=>{
  const doc=cloneDocument(BUILTIN_DOCUMENTS[1]);doc.id='revisions';const a=registerLevel(doc),state=createState(doc.id);state.resources.deposits[0].remaining=0;
  doc.objects[0].x+=12;const b=registerLevel(doc);assert.notEqual(a,b);assert.notEqual(a.revision,b.revision);
  assert.equal(createState(doc.id).resources.deposits[0].remaining,12);assert.equal(doc.deposits[0].amount,12);
  assert.ok(Math.abs(b.deposits[0].x-a.deposits[0].x-12)<1e-5);
});
test('history undoes transforms, theme edits and selection; redo branches correctly',()=>{
  const level=cloneDocument(BUILTIN_DOCUMENTS[1]),theme=structuredClone(THEMES.belt),history=new EditorHistory({level,theme,selection:'asteroid-0'});
  const original=structuredClone(history.current);history.change(s=>{s.level.objects[0].rotation=1.2;s.theme.sunIntensity=2;s.selection='base';});
  assert.ok(history.undo());assert.deepEqual(history.current,original);assert.ok(history.redo());assert.equal(history.current.theme.sunIntensity,2);
  history.undo();history.change(s=>s.level.name='Branch');assert.equal(history.redo(),false);
});
test('blocked spawn prevents play and insufficient resources produce an editable warning',()=>{
  const doc=cloneDocument(BUILTIN_DOCUMENTS[1]);doc.spawn={x:doc.objects[0].x,z:doc.objects[0].z};
  assert.ok(inspectLevel(doc).some(i=>i.severity==='error'&&i.objectId==='spawn'));
  doc.spawn={...BUILTIN_DOCUMENTS[1].spawn};doc.delivery.copper=999;
  assert.ok(inspectLevel(doc).some(i=>i.severity==='warning'&&i.message.includes('copper')));
});
test('concave contours preserve notches and swept movement cannot cross the rock',()=>{
  const solid={kind:'asteroid' as const,id:'concave',x:0,z:0,radius:12,height:12,footprint:[{x:-10,z:-10},{x:10,z:-10},{x:10,z:10},{x:3,z:10},{x:3,z:0},{x:-3,z:0},{x:-3,z:10},{x:-10,z:10}]};
  assert.ok(!contains(solid,{x:0,z:5},2));assert.ok(contains(solid,{x:0,z:-5}));
  assert.equal(sweep({x:0,z:15},{x:0,z:3},[solid],2),null);assert.ok(sweep({x:0,z:15},{x:0,z:-15},[solid],2));
});
test('ore surfaces and ray occlusion share rotation and scale with their host',()=>{
  const doc=cloneDocument(BUILTIN_DOCUMENTS[1]);doc.objects[0].rotation=.9;doc.objects[0].scale=.8;
  doc.deposits.filter(d=>d.structureId===doc.objects[0].id).forEach(d=>d.amount=oreMass(d.paint!,.8));
  const world=compileLevel(doc),host=world.solids[0],deposit=world.deposits[0],p=resolveOreCell(host,doc.deposits[0].paint!.cells[0]);
  assert.ok(Math.hypot(p.x-deposit.x,p.z-deposit.z)<.1);
  const n=deposit.surface!,origin={x:deposit.x+n.nx*18,y:p.y,z:deposit.z+n.nz*18};
  assert.ok(rayRock(host,origin,{x:-n.nx,y:0,z:-n.nz},30));
  const actor={...origin,speed:0,turret:Math.atan2(-n.nx,n.nz)};
  assert.equal(selectDeposit([deposit],actor,world)?.id,deposit.id);
});
