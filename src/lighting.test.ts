import test from 'node:test';
import assert from 'node:assert/strict';
import {themeLighting,newSkyBody,newLamp,newRockGlow,lightingErrors,coreMask,lampPulse} from './lighting';
import {THEMES} from './themes';
import {BUILTIN_DOCUMENTS,cloneDocument,packageLevel,parsePackage,validateDocument} from './level-document';
import {compileLevel} from './levels';
import {compileSculpt,newSculpt,validSculpt} from './sculpt';
import {createResourceState} from './resources';
test('legacy lighting preserves main and rim without making a sky body visible',()=>{
  for(const theme of Object.values(THEMES)){const l=themeLighting(theme);assert.deepEqual(lightingErrors(l),[]);assert.equal(l.bodies[0].intensity,theme.sunIntensity);assert.equal(l.bodies[1].intensity,theme.rimIntensity);assert.ok(l.bodies.every(b=>!b.visible));}
});
test('light data validates limits, references and duplicate IDs before compilation',()=>{
  const doc=cloneDocument(BUILTIN_DOCUMENTS[1]);doc.lighting=themeLighting(THEMES.belt);
  for(let i=0;i<3;i++)doc.lighting.bodies.push(newSkyBody('test-'+i,'planet'));
  assert.match(validateDocument(doc).map(i=>i.message).join(),/vier/);
  doc.lighting.bodies.splice(2);doc.lighting.primary='missing';assert.throws(()=>compileLevel(doc),/Hauptlicht/);
  doc.lighting.primary='sky-main';const lamp=newLamp(doc.objects[0].id,'buoy');doc.lighting.lamps.push(lamp);assert.throws(()=>compileLevel(doc),/IDs/);
  lamp.id='buoy';lamp.range=Infinity;assert.throws(()=>compileLevel(doc),/Lichtquelle/);
  doc.lighting={version:1,bodies:null,lamps:[]} as any;assert.doesNotThrow(()=>validateDocument(doc));assert.throws(()=>compileLevel(doc),/Lichtdaten/);
});
test('lighting, core and ore emission round trip as independent level data',()=>{
  const doc=cloneDocument(BUILTIN_DOCUMENTS[1]);doc.lighting=themeLighting(THEMES.belt);doc.lighting.lamps=[newLamp('lamp-test','reactor')];
  const source=Object.values(doc.sculpts!)[0];source.glow=newRockGlow();source.glow.core.enabled=true;doc.deposits[0].emission={color:'#33ff99',intensity:3};
  const parsed=parsePackage(JSON.stringify(packageLevel(doc))).level;assert.deepEqual(parsed,doc);
  const world=compileLevel(doc),state=createResourceState(world);state.deposits[0].emission!.intensity=0;assert.equal(world.deposits[0].emission!.intensity,3);assert.equal(doc.deposits[0].emission!.intensity,3);
  parsed.lighting!.lamps[0].intensity=0;assert.notEqual(doc.lighting.lamps[0].intensity,0);
});
test('glow painting and erasing leave density, contours and stone masks untouched',()=>{
  const s=newSculpt('glow-test','block');s.glow=newRockGlow();const original=compileSculpt(s);
  s.strokes.push({tool:'paint',layer:'glow',center:[0,0,21],radius:12,strength:1,seconds:.25});assert.ok(validSculpt(s));
  const painted=compileSculpt(s);assert.deepEqual(painted.high.positions,original.high.positions);assert.deepEqual(painted.contours,original.contours);assert.deepEqual(painted.high.paint,original.high.paint);
  const energy=(a:number[])=>a.reduce((a,b)=>a+b,0);assert.ok(energy(painted.high.glow!)>0);assert.ok(energy(painted.standard.glow!)>0);
  s.strokes.push({...s.strokes[0],erase:true});const erased=compileSculpt(s);assert.ok(energy(erased.high.glow!)<energy(painted.high.glow!));assert.deepEqual(erased.high.positions,original.high.positions);
});
test('core light exists only on exposed surfaces inside its local ellipsoid',()=>{
  const g=newRockGlow();assert.equal(coreMask(g,[0,0,0]),0);g.core.enabled=true;assert.equal(coreMask(g,[0,0,0]),1);assert.equal(coreMask(g,[20,0,0]),0);assert.ok(coreMask(g,[14,0,0])>0&&coreMask(g,[14,0,0])<1);
  const s=newSculpt('sealed','block'),sealed=compileSculpt(s);assert.ok(sealed.high.positions.every((_,i,a)=>i%3!==0||coreMask(g,a.slice(i,i+3))===0));
  s.shape='split';const opened=compileSculpt(s);assert.ok(opened.high.positions.some((_,i,a)=>i%3===0&&coreMask(g,a.slice(i,i+3))>0));
  for(let i=0;i<100;i++)for(const pattern of ['steady','pulse','flicker'] as const)assert.ok(lampPulse(pattern,i*.1)>=0&&lampPulse(pattern,i*.1)<=1);
});
