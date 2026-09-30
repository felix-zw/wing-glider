import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {newAtmosphere,newSkyBody,themeLighting,lightingErrors,skyBodyRadius} from './lighting';
import {THEMES} from './themes';
import {createSkyBody,updateSkyBody} from './sky-body';
import {cloneDocument,BUILTIN_DOCUMENTS,packageLevel,parsePackage} from './level-document';

test('planet atmosphere validates imported settings and defaults older bodies without migration',()=>{
  const b=newSkyBody('planet','planet'),l=themeLighting(THEMES.belt);b.illuminates=false;l.bodies.push(b);assert.deepEqual(lightingErrors(l),[]);
  b.air=newAtmosphere();assert.deepEqual(lightingErrors(l),[]);
  for(const air of [null,{...b.air,extent:0},{...b.air,extent:.51},{...b.air,strength:Infinity},{...b.air,color:'blue'}]){b.air=air as any;assert.match(lightingErrors(l).join(),/atmosphäre/);}
  b.air=newAtmosphere();b.kind='sun';assert.match(lightingErrors(l).join(),/atmosphäre/);
});
test('atmosphere height changes its shell without resizing the planet or reallocating geometry',()=>{
  const body=newSkyBody('planet','planet'),group=createSkyBody(body),camera=new THREE.PerspectiveCamera(),shell=group.children[1] as THREE.Mesh<THREE.SphereGeometry,THREE.ShaderMaterial>,geometry=shell.geometry;
  camera.updateMatrixWorld();const sun={x:1,y:1,z:0};updateSkyBody(group,body,camera,sun,0,true);
  assert.equal(shell.name,'planet-atmosphere');assert.equal(shell.scale.x,1.08);assert.equal(shell.material.uniforms.samples.value,12);
  body.air={...newAtmosphere(),extent:.3,strength:2,color:'#ca80ff'};updateSkyBody(group,body,camera,sun,0,false);
  assert.equal(shell.scale.x,1.3);assert.equal(group.scale.x,skyBodyRadius(body));assert.equal(shell.geometry,geometry);assert.equal(shell.material.uniforms.samples.value,8);assert.equal(shell.material.uniforms.strength.value,2);assert.equal(shell.material.uniforms.tint.value.getHexString(),'ca80ff');assert.ok(shell.material.uniforms.centre.value.equals(group.position));
  body.atmosphere=false;updateSkyBody(group,body,camera,sun);assert.equal(shell.visible,false);
});
test('atmosphere settings round trip in independent level and template-free JSON data',()=>{
  const doc=cloneDocument(BUILTIN_DOCUMENTS[1]),planet=newSkyBody('air-planet','planet');planet.illuminates=false;planet.air={extent:.2,strength:1.7,color:'#89cbff'};doc.lighting=themeLighting(THEMES.belt);doc.lighting.bodies.push(planet);
  const loaded=parsePackage(JSON.stringify(packageLevel(doc))).level;assert.deepEqual(loaded.lighting!.bodies.at(-1)!.air,planet.air);loaded.lighting!.bodies.at(-1)!.air!.extent=.4;assert.equal(planet.air.extent,.2);
});
