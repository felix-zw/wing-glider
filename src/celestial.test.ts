import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {newSkyBody,newCorona,newPlanetRing,minimumSkyDistance,skyBodyRadius,themeLighting,lightingErrors} from './lighting';
import {THEMES} from './themes';
import {ringFrame,ringCoverage,RingParticles,ringDebrisCenter,ringSurfaceDistance} from './planet-ring';
import {createSkyBody,updateSkyBody} from './sky-body';
import {BUILTIN_DOCUMENTS,cloneDocument,packageLevel,parsePackage} from './level-document';
import {gameCameraQuaternion,gameViewAngles} from './game-camera';

test('close celestial bodies remain outside their physical radius and older data stays valid',()=>{
  const b=newSkyBody('planet','planet'),l=themeLighting(THEMES.belt);b.distance=minimumSkyDistance(b);l.bodies.push(b);assert.deepEqual(lightingErrors(l),[]);assert.ok(b.distance<800&&b.distance>skyBodyRadius(b));
  b.distance-=.001;assert.match(lightingErrors(l).join(),/Abstand/);b.size=1;b.distance=25;assert.deepEqual(lightingErrors(l),[]);
});
test('ring and corona data validate malformed imported values',()=>{
  const l=themeLighting(THEMES.belt),p=newSkyBody('p','planet');p.illuminates=false;p.ring=newPlanetRing();l.bodies.push(p);
  for(const value of [{...p.ring,orientation:[0,0,0,0]},{...p.ring,inner:3,outer:2},{...p.ring,orientation:null},{...p.ring,density:Infinity}]){p.ring=value as any;assert.match(lightingErrors(l).join(),/ring/i);}
  p.ring=newPlanetRing();l.bodies[0].corona={...newCorona(),extent:3};assert.match(lightingErrors(l).join(),/korona/i);l.bodies[0].corona=newCorona();assert.deepEqual(lightingErrors(l),[]);
});
test('ring masks follow the same concentric rotation and have no hidden offset',()=>{
  const p=newSkyBody('p','planet');p.azimuth=0;p.elevation=0;p.distance=400;p.ring={...newPlanetRing(),enabled:true};const f=ringFrame(p),point=new THREE.Vector3(f.radius*2,0,0);
  assert.ok(ringCoverage(p,point.clone().add(f.center))>.5);assert.equal(ringCoverage(p,f.center),0);assert.equal(ringCoverage(p,point.clone().add(f.center).add(new THREE.Vector3(0,100,0))),0);
  p.ring.orientation=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),Math.PI/2).toArray();const rotated=ringFrame(p);assert.ok(rotated.center.distanceTo(f.center)<1e-9);assert.ok(ringCoverage(p,point.applyQuaternion(rotated.rotation).add(f.center))>.5);
});
test('dust shares a global quality budget, stable seed geometry, illumination and releases disabled rings',()=>{
  const bodies=Array.from({length:3},(_,i)=>({...newSkyBody('ring-'+i,'planet'),ring:{...newPlanetRing(),enabled:true}}));const dust=new RingParticles();dust.set(bodies);assert.ok(dust.count<=2000);const geometry=(dust.root.children[0] as THREE.Mesh).geometry as THREE.InstancedBufferGeometry,positions=geometry.getAttribute('anchor').array.slice();
  assert.ok(geometry.isInstancedBufferGeometry);assert.equal(geometry.getAttribute('position').count,60);assert.ok(geometry.getAttribute('position').array.some((v,i)=>i%3===1&&v!==0));
  dust.high=false;dust.set(bodies);assert.ok(dust.count<=700);assert.equal((dust.root.children[0] as THREE.Mesh).geometry,geometry);assert.deepEqual(geometry.getAttribute('anchor').array,positions);
  dust.update(new THREE.Vector3(),4,1,new THREE.Color(.2,.3,.4));assert.equal(((dust.root.children[0] as THREE.Mesh).material as THREE.ShaderMaterial).uniforms.time.value,4);
  dust.set([]);assert.equal(dust.root.children.length,0);assert.equal(dust.count,0);dust.dispose();
});
test('near debris is anchored in the rotated ring plane, remains stationary and culls distant batches',()=>{
  const body=newSkyBody('debris','planet');body.distance=400;body.azimuth=0;body.elevation=0;body.ring={...newPlanetRing(),enabled:true,orientation:new THREE.Quaternion().setFromEuler(new THREE.Euler(.4,.2,.7)).toArray()};
  const f=ringFrame(body),focus=new THREE.Vector3(f.radius*2,0,0).applyQuaternion(f.rotation).add(f.center),anchor=new THREE.Vector3(.1,.2,.3),p=ringDebrisCenter(body,anchor,focus);
  const shifted=ringDebrisCenter(body,anchor,focus.clone().add(new THREE.Vector3(.01,0,.01)));assert.ok(p.distanceTo(shifted)<1e-8);assert.ok(Math.abs(p.clone().sub(f.center).dot(f.normal))<10);assert.ok(ringSurfaceDistance(body,focus)<1e-8);
  const debris=new RingParticles();debris.set([body]);debris.update(focus,0,1);assert.ok(debris.root.children[0].visible);debris.update(focus.clone().addScaledVector(f.normal,300),0,1);assert.equal(debris.root.children[0].visible,false);debris.dispose();
});
test('shared solar materials animate with supplied time, freeze on pause and reduce arc budget',()=>{
  const b=newSkyBody('s','sun');b.corona=newCorona();const group=createSkyBody(b),camera=new THREE.PerspectiveCamera();camera.updateMatrixWorld();updateSkyBody(group,b,camera,{x:1,y:1,z:0},10,true);
  const u=((group.children[2] as THREE.Mesh).material as THREE.ShaderMaterial).uniforms;assert.equal(u.detail.value,4);const t=u.time.value;updateSkyBody(group,b,camera,{x:1,y:1,z:0},10,false);assert.equal(u.time.value,t);assert.equal(u.detail.value,2);updateSkyBody(group,b,camera,{x:1,y:1,z:0},11);assert.ok(u.time.value>t);
});
test('saved celestial settings are independent JSON level data',()=>{
  const doc=cloneDocument(BUILTIN_DOCUMENTS[1]);doc.lighting=themeLighting(THEMES.belt);const p=newSkyBody('p','planet');p.ring={...newPlanetRing(),enabled:true};doc.lighting.bodies.push(p);doc.lighting.bodies[0].corona=newCorona();const parsed=parsePackage(JSON.stringify(packageLevel(doc))).level;
  assert.deepEqual(parsed,doc);parsed.lighting!.bodies.at(-1)!.ring!.orientation[0]=.3;parsed.lighting!.bodies[0].corona!.strength=4;assert.equal(p.ring.orientation[0],0);assert.equal(doc.lighting.bodies[0].corona.strength,1.4);
});
test('overview game angle has the gameplay camera orientation',()=>{
  const {yaw,pitch}=gameViewAngles(),camera=new THREE.PerspectiveCamera();camera.position.set(Math.cos(yaw)*Math.cos(pitch),Math.sin(pitch),Math.sin(yaw)*Math.cos(pitch));camera.lookAt(0,0,0);assert.ok(camera.quaternion.angleTo(gameCameraQuaternion())<1e-7);
});
