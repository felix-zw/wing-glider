import * as THREE from 'three';
import {direction,newCorona,newPlanetRing,skyBodyRadius,type SkyBody} from './lighting';
import {createPlanetAtmosphere,updatePlanetAtmosphere} from './planet-atmosphere';
export {skyBodyRadius} from './lighting';

const skyFragment=`varying vec3 n;varying vec3 p;uniform vec3 tint;uniform vec3 sunlight;uniform float kind;uniform float variant;uniform float time;
float hash(vec3 q){q=fract(q*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float noise(vec3 q){vec3 i=floor(q),f=fract(q);f=f*f*(3.-2.*f);return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
float fbm(vec3 q){return noise(q)*.55+noise(q*2.13+vec3(7,19,3))*.27+noise(q*4.37+vec3(29,2,11))*.13+noise(q*9.17)*.05;}
void main(){vec3 normal=normalize(n);float broad=fbm(p*3.1+vec3(14,7,31)),grain=noise(p*70.)*.12;
if(kind<.5){vec3 flow=p*18.+vec3(time*.22,-time*.17,time*.09);float cells=fbm(flow+vec3(fbm(flow*1.3))*2.8);float fissure=smoothstep(.38,.52,cells);float hot=pow(smoothstep(.48,.78,cells),2.);vec3 fire=mix(vec3(.55,.035,.003),tint*2.6,fissure);fire=mix(fire,vec3(5.,3.8,2.2),hot);float limb=.5+.5*pow(max(0.,normal.z),.35);gl_FragColor=vec4(fire*limb,1.);}
else {float land=smoothstep(.46,.52,broad),mountain=fbm(p*19.);vec3 earth=mix(vec3(.028,.075,.023),vec3(.26,.19,.09),mountain);
vec3 surface=variant<.5?mix(vec3(.07,.06,.055),vec3(.38,.31,.25),broad+grain):variant<1.5?mix(vec3(.008,.035,.095),earth,land):mix(vec3(.21,.085,.04),vec3(.6,.4,.21),smoothstep(.1,.9,.5+.5*sin(p.y*35.+broad*9.)));
float ice=smoothstep(.78,.94,abs(p.y)+broad*.08);if(variant>.5&&variant<1.5)surface=mix(surface,vec3(.65,.73,.76),ice);
float clouds=smoothstep(.54,.7,fbm(p*7.+vec3(broad*2.,0,0)));if(variant<1.5)surface=mix(surface,vec3(.63,.7,.75),clouds*.8);
float day=max(0.,dot(normal,normalize(sunlight)));gl_FragColor=vec4(surface*tint*(.065+day*2.4),1.);}
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`;
const coronaFragment=`varying vec2 vUv;uniform vec3 tint;uniform float time;uniform float extent;uniform float power;uniform float detail;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);}
void main(){vec2 p=(vUv*2.-1.)*(1.+extent);float r=length(p),a=atan(p.y,p.x);if(r<1.||r>1.+extent)discard;vec2 polar=vec2(cos(a),sin(a));float stream=noise(polar*9.+vec2(time*.19,r*4.-time*.7));stream=stream*.65+noise(polar*23.+vec2(-time*.27,r*7.))*.35;
float height=extent*(.18+.82*pow(stream,1.8));float flame=1.-smoothstep(.025,height,r-1.);flame*=pow(stream,.8);float arcs=0.;
for(int i=0;i<4;i++){if(float(i)>=detail)break;float centre=float(i)*1.73+.24*sin(time*.14+float(i));float angle=abs(atan(sin(a-centre),cos(a-centre)));float span=.13+.055*sin(float(i)+1.);float arch=1.+extent*(.45+.18*sin(time*.13+float(i)))*sqrt(max(0.,1.-pow(angle/span,2.)));arcs+=exp(-pow((r-arch)/.017,2.))*step(angle,span)*( .5+.5*noise(polar*31.+time*.3));}
float halo=exp(-(r-1.)/max(.05,extent*.24))*.3;float alpha=(flame*.9+arcs*.7+halo)*smoothstep(1.,1.025,r)*(1.-smoothstep(1.+extent*.85,1.+extent,r));vec3 color=mix(vec3(2.3,.12,.005),tint*3.,exp(-(r-1.)*5.));gl_FragColor=vec4(color*power,clamp(alpha,0.,1.));
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`;
const ringFragment=`varying vec3 local;uniform float inner;uniform float outer;uniform vec3 tint;uniform float opacity;uniform vec3 sun;varying vec3 ringWorld;uniform float bodyRadius;uniform vec3 nearFocus;uniform float useNear;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);}
void main(){float r=length(local.xz);if(r<inner||r>outer)discard;vec2 metres=local.xz*bodyRadius;vec2 broken=metres+vec2(noise(metres*.035),noise(metres*.029+17.))*15.;float grit=noise(broken*.8),clumps=noise(broken*.075),bands=.84+.16*sin(r*62.+noise(metres*.01)*2.);float gap=1.-.93*exp(-pow((r-mix(inner,outer,.63))/.022,2.));float edge=smoothstep(inner,inner+.025,r)*(1.-smoothstep(outer-.035,outer,r));
vec3 world=ringWorld;float nearFade=useNear>.5?smoothstep(65.,200.,distance(world,nearFocus)):1.;float projection=dot(local,sun);float hit=dot(local,local)-projection*projection;float shadow=projection<0.?smoothstep(.87,1.05,sqrt(max(0.,hit))):1.;float rubble=smoothstep(.27,.69,grit)*mix(.3,1.,clumps);vec3 color=mix(tint*.22,tint*vec3(.85,.94,1.05),rubble)*mix(.2,1.,shadow);gl_FragColor=vec4(color,opacity*bands*gap*edge*mix(.12,.95,rubble)*nearFade);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`;
const planeVertex='varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}';
export function createSkyBody(body:SkyBody){
  const group=new THREE.Group(),material=new THREE.ShaderMaterial({uniforms:{tint:{value:new THREE.Color()},sunlight:{value:new THREE.Vector3(1,1,1)},kind:{value:body.kind==='sun'?0:1},variant:{value:0},time:{value:0}},vertexShader:'varying vec3 n;varying vec3 p;void main(){p=position;n=normalize(normalMatrix*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:skyFragment});
  group.add(new THREE.Mesh(new THREE.SphereGeometry(1,48,32),material));
  const halo=body.kind==='planet'?createPlanetAtmosphere():new THREE.Mesh(new THREE.SphereGeometry(1.07,32,20),new THREE.ShaderMaterial({uniforms:{tint:{value:new THREE.Color(body.color)},power:{value:1}},vertexShader:'varying vec3 n;varying vec3 v;void main(){vec4 mv=modelViewMatrix*vec4(position,1.);n=normalize(normalMatrix*normal);v=normalize(-mv.xyz);gl_Position=projectionMatrix*mv;}',fragmentShader:'varying vec3 n;varying vec3 v;uniform vec3 tint;uniform float power;void main(){float rim=pow(1.-abs(dot(normalize(n),normalize(v))),3.);gl_FragColor=vec4(tint*1.6,rim*power);}',transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.BackSide}));group.add(halo);
  if(body.kind==='sun'){
    const flame=new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.ShaderMaterial({uniforms:{tint:{value:new THREE.Color(body.color)},time:{value:0},extent:{value:.55},power:{value:1.4},detail:{value:4}},vertexShader:planeVertex,fragmentShader:coronaFragment,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide,forceSinglePass:true}));flame.name='solar-corona';group.add(flame);
  }else{
    const geometry=new THREE.CircleGeometry(1,128);geometry.rotateX(-Math.PI/2);
    const ring=new THREE.Mesh(geometry,new THREE.ShaderMaterial({uniforms:{inner:{value:1.3},outer:{value:2.8},tint:{value:new THREE.Color()},opacity:{value:.78},sun:{value:new THREE.Vector3()},bodyRadius:{value:1},nearFocus:{value:new THREE.Vector3()},useNear:{value:0}},vertexShader:'varying vec3 local;varying vec3 ringWorld;uniform float outer;void main(){local=position*outer;ringWorld=(modelMatrix*vec4(local,1.)).xyz;gl_Position=projectionMatrix*modelViewMatrix*vec4(local,1.);}',fragmentShader:ringFragment,transparent:true,depthWrite:false,side:THREE.DoubleSide,forceSinglePass:true}));
    // Shader expansion must also be reflected in CPU frustum bounds.
    geometry.boundingSphere=new THREE.Sphere(new THREE.Vector3(),20);ring.name='planet-ring';group.add(ring);
  }
  return group;
}
export function updateSkyBody(group:THREE.Group,body:SkyBody,camera:THREE.Camera,sunDirection:{x:number;y:number;z:number},time=0,high=true,nearFocus?:THREE.Vector3){
  const d=direction(body.azimuth,body.elevation),distance=body.distance??1000;
  group.visible=body.visible;group.position.set(d.x*distance,d.y*distance,d.z*distance);group.scale.setScalar(skyBodyRadius(body));
  const u=((group.children[0] as THREE.Mesh).material as THREE.ShaderMaterial).uniforms;
  u.tint.value.set(body.color);u.variant.value=['rocky','ocean','gas'].indexOf(body.surface);u.sunlight.value.copy(sunDirection).transformDirection(camera.matrixWorldInverse);u.time.value=time*(body.corona?.motion??.45);
  if(body.kind==='planet')updatePlanetAtmosphere(group.children[1] as THREE.Mesh,body,sunDirection,high);
  else{group.children[1].visible=body.atmosphere;const halo=((group.children[1] as THREE.Mesh).material as THREE.ShaderMaterial).uniforms;halo.tint.value.set(body.color);halo.power.value=(body.corona?.strength??1.4)*.65;}
  const extra=group.children[2] as THREE.Mesh,u2=(extra.material as THREE.ShaderMaterial).uniforms;
  if(body.kind==='sun'){
    const c=body.corona??newCorona();extra.visible=body.atmosphere&&c.strength>0;extra.quaternion.copy(camera.quaternion);extra.scale.setScalar(1+c.extent);u2.tint.value.set(body.color);u2.extent.value=c.extent;u2.power.value=c.strength;u2.time.value=time*c.motion;u2.detail.value=high?4:2;
  }else{
    const r=body.ring??newPlanetRing();extra.visible=r.enabled;extra.quaternion.fromArray(r.orientation);u2.bodyRadius.value=skyBodyRadius(body);u2.useNear.value=nearFocus?1:0;if(nearFocus)u2.nearFocus.value.copy(nearFocus);u2.inner.value=r.inner;u2.outer.value=r.outer;u2.tint.value.set(r.color);u2.opacity.value=r.opacity;u2.sun.value.copy(sunDirection).applyQuaternion(extra.quaternion.clone().invert()).normalize();
  }
}
