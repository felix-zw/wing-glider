import * as THREE from 'three';
import {minimumSkyDistance,type SkyBody} from './lighting';

export type Hemisphere=1|-1;
export const clampSkyDistance=(distance:number,body:Pick<SkyBody,'size'>={size:1})=>THREE.MathUtils.clamp(distance,minimumSkyDistance(body),20000);
export function skyAngles(point:THREE.Vector3){
  const p=point.clone().normalize();
  return {azimuth:Math.atan2(p.z,p.x)*180/Math.PI,elevation:Math.asin(THREE.MathUtils.clamp(p.y,-1,1))*180/Math.PI};
}
/** Choose the intersection continuous with the last position, never the hidden half. */
export function pointOnHemisphere(ray:THREE.Ray,radius:number,side:Hemisphere,previous:THREE.Vector3){
  const t=-ray.origin.dot(ray.direction),closest=ray.at(t,new THREE.Vector3()),delta=radius*radius-closest.lengthSq();
  if(delta>=0){
    const h=Math.sqrt(delta),points=[t-h,t+h].filter(v=>v>=0).map(v=>ray.at(v,new THREE.Vector3())).filter(p=>p.y*side>=-1e-6);
    if(points.length)return points.sort((a,b)=>a.distanceToSquared(previous)-b.distanceToSquared(previous))[0];
  }
  // Off the shell: project onto its horizon instead of jumping to the back side.
  const planePoint=ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,1,0),0),new THREE.Vector3());
  const p=planePoint??ray.at(Math.max(0,t),new THREE.Vector3());p.y=0;
  if(p.lengthSq()<1e-10)p.copy(previous).setY(0);
  if(p.lengthSq()<1e-10)p.set(1,0,0);
  return p.normalize().multiplyScalar(radius);
}
