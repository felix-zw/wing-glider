import * as THREE from 'three';
import {direction,skyBodyRadius,type SkyBody} from './lighting';

export function ringFrame(body:SkyBody){
  const rotation=new THREE.Quaternion().fromArray(body.ring?.orientation??[0,0,0,1]);
  return {center:new THREE.Vector3().copy(direction(body.azimuth,body.elevation)).multiplyScalar(body.distance??1000),rotation,normal:new THREE.Vector3(0,1,0).applyQuaternion(rotation),radius:skyBodyRadius(body)};
}
export function ringCoverage(body:SkyBody,point:THREE.Vector3){
  if(!body.visible||!body.ring?.enabled)return 0;
  const f=ringFrame(body),p=point.clone().sub(f.center).applyQuaternion(f.rotation.invert()),r=Math.hypot(p.x,p.z)/f.radius;
  const edge=Math.min((r-body.ring.inner)/.16,(body.ring.outer-r)/.16),height=Math.abs(p.y)/(Math.max(12,f.radius*.08));
  return THREE.MathUtils.smoothstep(edge,0,1)*(1-THREE.MathUtils.smoothstep(height,.25,1))*body.ring.density;
}

export const RING_PATCH_HALF=128;
export function ringSurfaceDistance(body:SkyBody,point:THREE.Vector3){const f=ringFrame(body),p=point.clone().sub(f.center).applyQuaternion(f.rotation.invert()),r=Math.hypot(p.x,p.z),inner=(body.ring?.inner??1.3)*f.radius,outer=(body.ring?.outer??2.8)*f.radius;return Math.hypot(p.y,Math.max(inner-r,0,r-outer));}
/** Wrap only outside the invisible fringe; moving the focus leaves visible stones stationary. */
export function ringDebrisCenter(body:SkyBody,anchor:THREE.Vector3,focus:THREE.Vector3){const f=ringFrame(body),local=focus.clone().sub(f.center).applyQuaternion(f.rotation.clone().invert()),wrap=(p:number,c:number)=>THREE.MathUtils.euclideanModulo(p-c+128,256)-128+c;return new THREE.Vector3(wrap(anchor.x*128,local.x),anchor.y*Math.min(10,Math.max(3,f.radius*.025)),wrap(anchor.z*128,local.z)).applyQuaternion(f.rotation).add(f.center);}

/** One GPU-instanced batch per ring. Each grain is a closed, shaded three-dimensional rock. */
export class RingParticles {
  readonly root=new THREE.Group();private patches=new Map<string,THREE.Mesh<THREE.InstancedBufferGeometry,THREE.ShaderMaterial>>();
  high=true;count=0;
  constructor(){this.root.name='near-ring-particles';}
  set(bodies:readonly SkyBody[]){
    const active=bodies.filter(b=>b.kind==='planet'&&b.visible&&b.ring?.enabled&&b.ring.density>0),ids=new Set(active.map(b=>b.id));
    for(const [id,p] of this.patches)if(!ids.has(id)){p.removeFromParent();p.geometry.dispose();p.material.dispose();this.patches.delete(id);}
    for(const b of active)if(!this.patches.has(b.id)){
      const anchors=new Float32Array(2000*3),seeds=new Float32Array(2000);let seed=7417;
      for(const c of b.id)seed=(Math.imul(seed,31)+c.charCodeAt(0))>>>0;
      const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
      for(let i=0;i<2000;i++){anchors[i*3]=random()*2-1;anchors[i*3+1]=random()*2-1;anchors[i*3+2]=random()*2-1;seeds[i]=random();}
      const base=new THREE.IcosahedronGeometry(1,0),vertices=base.getAttribute('position');
      for(let i=0;i<vertices.count;i++){const p=new THREE.Vector3().fromBufferAttribute(vertices,i),scale=.83+.11*Math.sin(p.x*7+p.y*11)+.08*Math.cos(p.z*9-p.x*4);vertices.setXYZ(i,p.x*scale,p.y*scale,p.z*scale);}base.computeVertexNormals();
      const geometry=new THREE.InstancedBufferGeometry();geometry.setAttribute('position',base.getAttribute('position').clone());geometry.setAttribute('normal',base.getAttribute('normal').clone());base.dispose();geometry.setAttribute('anchor',new THREE.InstancedBufferAttribute(anchors,3));geometry.setAttribute('seed',new THREE.InstancedBufferAttribute(seeds,1));
      const material=new THREE.ShaderMaterial({uniforms:{center:{value:new THREE.Vector3()},rotation:{value:new THREE.Matrix3()},inverseRing:{value:new THREE.Matrix3()},radii:{value:new THREE.Vector2()},radius:{value:1},focus:{value:new THREE.Vector3()},color:{value:new THREE.Color()},power:{value:0},time:{value:0},sun:{value:new THREE.Vector3(0,1,0)}},vertexShader:
`attribute vec3 anchor;attribute float seed;uniform vec3 focus;uniform vec3 center;uniform mat3 rotation;uniform mat3 inverseRing;uniform vec2 radii;uniform float radius;uniform float power;uniform float time;varying vec3 rockNormal;varying vec3 rockPosition;varying vec3 worldPosition;varying float visibility;varying float ice;
mat3 spin(float a,float b){float c=cos(a),s=sin(a),d=cos(b),t=sin(b);return mat3(c,0.,s,0.,1.,0.,-s,0.,c)*mat3(1.,0.,0.,0.,d,t,0.,-t,d);}
void main(){vec3 near=inverseRing*(focus-center);vec3 p=anchor*vec3(128.,min(10.,max(3.,radius*.025)),128.);p.xz=mod(p.xz-near.xz+128.,256.)-128.+near.xz;vec3 world=center+rotation*p;float r=length(p.xz)/radius;float band=smoothstep(radii.x,radii.x+.08,r)*(1.-smoothstep(radii.y-.08,radii.y,r));float gap=1.-.92*exp(-pow((r-mix(radii.x,radii.y,.63))/.022,2.));float fade=1.-smoothstep(85.,125.,distance(world,focus));float occupancy=step(fract(seed*73.13),power);visibility=band*gap*fade*occupancy;ice=step(.73,fract(seed*19.17));float size=.13+.62*pow(seed,2.)+2.5*pow(max(0.,(seed-.87)/.13),2.);mat3 tumble=spin(seed*31.+time*.015,seed*53.+time*.01);vec3 scales=vec3(.7+.5*fract(seed*7.),.5+.7*fract(seed*13.),.8+.4*fract(seed*23.));rockPosition=position;rockNormal=rotation*tumble*normalize(normal/scales);worldPosition=world+rotation*tumble*(position*scales*size);gl_Position=visibility>.005?projectionMatrix*viewMatrix*vec4(worldPosition,1.):vec4(2.,2.,2.,1.);}`,fragmentShader:
`uniform vec3 color;uniform vec3 sun;uniform vec3 center;uniform float radius;varying vec3 rockNormal;varying vec3 rockPosition;varying vec3 worldPosition;varying float visibility;varying float ice;
float hash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}void main(){if(visibility<hash(vec3(floor(gl_FragCoord.xy),0.)))discard;vec3 n=normalize(rockNormal),light=normalize(sun);float grain=hash(floor(rockPosition*27.)),strata=.5+.5*sin(rockPosition.y*21.+rockPosition.x*9.);vec3 stone=color*mix(.28,.8,grain*.45+strata*.55);stone=mix(stone,color*vec3(.85,1.02,1.2)*( .65+grain*.3),ice);float projection=dot(worldPosition-center,light),hit=length(worldPosition-center-light*projection);float shadow=projection<0.?smoothstep(radius*.96,radius*1.04,hit):1.;float diffuse=max(0.,dot(n,light));vec3 view=normalize(cameraPosition-worldPosition);float sheen=pow(max(0.,dot(reflect(-light,n),view)),18.)*.3*ice;gl_FragColor=vec4(stone*(.23+diffuse*1.65*shadow)+color*sheen*shadow,1.);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`});
      const mesh=new THREE.Mesh(geometry,material);mesh.frustumCulled=false;mesh.userData.excludeAO=true;mesh.name='ring-rock-and-ice';this.patches.set(b.id,mesh);this.root.add(mesh);
    }
    this.count=0;const allocation=Math.floor((this.high?2000:700)/Math.max(1,active.length));
    for(const b of active){const p=this.patches.get(b.id)!,f=ringFrame(b),u=p.material.uniforms;p.geometry.instanceCount=allocation;this.count+=allocation;p.userData.body=structuredClone(b);
      u.center.value.copy(f.center);u.rotation.value.setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(f.rotation));u.inverseRing.value.copy(u.rotation.value).transpose();u.radii.value.set(b.ring!.inner,b.ring!.outer);u.radius.value=f.radius;p.userData.color=new THREE.Color(b.ring!.color);u.color.value.copy(p.userData.color);u.power.value=b.ring!.density*b.ring!.opacity;
    }
  }
  update(focus:THREE.Vector3,time:number,_pixelRatio:number,illumination=new THREE.Color(1,1,1),sun={x:0,y:1,z:0}){for(const p of this.patches.values()){p.visible=ringSurfaceDistance(p.userData.body,focus)<125;p.material.uniforms.focus.value.copy(focus);p.material.uniforms.time.value=time;p.material.uniforms.color.value.copy(p.userData.color).multiply(illumination);p.material.uniforms.sun.value.copy(sun);}}
  dispose(){for(const p of this.patches.values()){p.geometry.dispose();p.material.dispose();}this.root.clear();this.root.removeFromParent();this.patches.clear();}
}
