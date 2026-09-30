import * as THREE from 'three';
import {ASTEROIDS,type AsteroidAsset} from './asset-catalog';
import {compileSculpt,type SculptCompiled,type SculptDefinition,type SculptMesh} from './sculpt';

const cache=new Map<string,{signature:string;compiled:SculptCompiled;asset?:AsteroidAsset;levelId:string;objectId:string}>();
export const sculptAssetId=(levelId:string,objectId:string)=>`sculpt-${levelId}-${objectId}`;
const geometrySignature=(source:SculptDefinition)=>JSON.stringify([source.version,source.shape,source.seed,source.variation,source.strokes]);
export const sculptKey=(source:SculptDefinition,scale=1)=>geometrySignature(source)+scale;
export function registeredSculptKey(levelId:string,objectId:string){return cache.get(sculptAssetId(levelId,objectId))?.signature;}
const shared=new Map<string,SculptCompiled>();
export function registerSculpt(levelId:string,objectId:string,source:SculptDefinition,scale=1){
  const id=sculptAssetId(levelId,objectId),signature=sculptKey(source,scale);
  let entry=cache.get(id);if(!entry||entry.signature!==signature){let compiled=shared.get(signature);if(!compiled){compiled=compileSculpt(source,scale);shared.set(signature,compiled);if(shared.size>32)shared.delete(shared.keys().next().value!);}entry={signature,compiled,levelId,objectId};cache.set(id,entry);}
  if(entry.asset)return entry.asset;
  const result=entry.compiled;
  const asset:AsteroidAsset={id,name:source.name,footprint:result.contours[0]??[],footprints:result.contours,vertices:result.vertices,indices:result.indices};
  ASTEROIDS[id]=asset;entry.asset=asset;return asset;
}
export function installSculpt(levelId:string,objectId:string,source:SculptDefinition,compiled:SculptCompiled,scale=1){
  const previous=cache.get(sculptAssetId(levelId,objectId));if(previous?.signature.startsWith(geometrySignature(source)))compiled={...compiled,high:previous.compiled.high,standard:previous.compiled.standard,vertices:previous.compiled.vertices,indices:previous.compiled.indices};
  const signature=sculptKey(source,scale);shared.set(signature,compiled);if(shared.size>32)shared.delete(shared.keys().next().value!);
  cache.set(sculptAssetId(levelId,objectId),{signature,compiled,levelId,objectId});
  return registerSculpt(levelId,objectId,source,scale);
}
export function getSculpt(levelId:string,objectId:string){return cache.get(sculptAssetId(levelId,objectId))?.compiled;}
export function retainSculpts(levelId:string,objectIds:readonly string[]){const keep=new Set(objectIds);for(const [id,entry] of cache)if(entry.levelId===levelId&&!keep.has(entry.objectId)){cache.delete(id);delete ASTEROIDS[id];}}
export function sculptGeometry(mesh:SculptMesh){
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(mesh.positions,3));
  geometry.setAttribute('normal',new THREE.Float32BufferAttribute(mesh.normals,3));
  geometry.setAttribute('sculptPaint',new THREE.Float32BufferAttribute(mesh.paint,4));
  geometry.setAttribute('sculptGlow',new THREE.Float32BufferAttribute(mesh.glow??new Array(mesh.positions.length/3).fill(0),1));
  geometry.setIndex(mesh.indices);geometry.computeBoundingSphere();
  return geometry;
}
