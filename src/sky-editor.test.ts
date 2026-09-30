import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {pointOnHemisphere,skyAngles,clampSkyDistance} from './sky-editor-math';
import {direction,newSkyBody} from './lighting';
import {createSkyBody,updateSkyBody,skyBodyRadius} from './sky-body';

test('spatial sky coordinates round-trip above and below the horizon',()=>{
  for(const azimuth of [-179,-90,0,46,180])for(const elevation of [-89,-35,0,27,89]){
    const p=new THREE.Vector3().copy(direction(azimuth,elevation)).multiplyScalar(9000),a=skyAngles(p);
    assert.ok(Math.abs(a.azimuth-azimuth)<1e-8);assert.ok(Math.abs(a.elevation-elevation)<1e-8);
  }
});
test('hemisphere drag chooses the intersection nearest the previous surface point',()=>{
  const ray=new THREE.Ray(new THREE.Vector3(0,500,3000),new THREE.Vector3(0,0,-1));
  for(const z of [-866,866]){const p=pointOnHemisphere(ray,1000,1,new THREE.Vector3(0,500,z));assert.ok(Math.abs(p.length()-1000)<1e-8);assert.equal(Math.sign(p.z),Math.sign(z));assert.ok(p.y>=0);}
});
test('hemisphere drag remains on its side and clamps missed rays to the horizon',()=>{
  const previous=new THREE.Vector3(1000,0,0);
  for(const side of [1,-1] as const)for(const ray of [new THREE.Ray(new THREE.Vector3(2500,2500,2500),new THREE.Vector3(0,-1,0)),new THREE.Ray(new THREE.Vector3(0,-2000,0),new THREE.Vector3(0,1,0))]){
    const p=pointOnHemisphere(ray,1000,side,previous);assert.ok(Math.abs(p.length()-1000)<1e-8);assert.ok(p.y*side>=-1e-8);
  }
  const miss=pointOnHemisphere(new THREE.Ray(new THREE.Vector3(2500,2500,2500),new THREE.Vector3(0,-1,0)),1000,1,previous);assert.equal(miss.y,0);
});
test('distance limits and shared celestial rendering keep physical size independent of distance',()=>{
  assert.equal(clampSkyDistance(100),100);assert.equal(clampSkyDistance(0),25);assert.equal(clampSkyDistance(40000),20000);
  const body=newSkyBody('planet','planet'),group=createSkyBody(body),camera=new THREE.PerspectiveCamera();camera.updateMatrixWorld();
  updateSkyBody(group,body,camera,direction(0,40));const radius=skyBodyRadius(body);body.distance=20000;updateSkyBody(group,body,camera,direction(0,40));
  assert.ok(Math.abs(group.position.length()-20000)<1e-8);assert.equal(group.scale.x,radius);
  body.visible=false;updateSkyBody(group,body,camera,direction(0,40));assert.equal(group.visible,false);
  group.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();(o.material as THREE.Material).dispose();}});
});
