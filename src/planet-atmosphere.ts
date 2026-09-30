import * as THREE from 'three';
import {newAtmosphere,skyBodyRadius,type SkyBody} from './lighting';

// Integrate a thin spherical density layer. The opaque planet shortens the ray;
// its night side also blocks sunlight, so this is not a uniform emissive outline.
const fragment=`
varying vec3 worldExit;
uniform mat4 projectionMatrix;
uniform vec3 centre; uniform float radius; uniform float extent;
uniform vec3 tint; uniform float strength; uniform vec3 sunlight; uniform float samples;
vec2 sphere(vec3 origin,vec3 ray,float r){float b=dot(origin,ray),d=b*b-dot(origin,origin)+r*r;return d<0.?vec2(1.,-1.):vec2(-b-sqrt(d),-b+sqrt(d));}
void main(){
  vec3 origin=(cameraPosition-centre)/radius,ray=normalize(worldExit-cameraPosition),sun=normalize(sunlight);
  vec2 outer=sphere(origin,ray,1.+extent),ground=sphere(origin,ray,1.);
  float start=max(0.,outer.x),end=outer.y;
  if(ground.x>0.&&ground.y>ground.x)end=min(end,ground.x);
  if(end<=start||strength<=0.)discard;
  float stepLength=(end-start)/samples,depth=0.,mu=dot(ray,sun);
  float rayleigh=.75*(1.+mu*mu),mie=.12/pow(max(.12,1.49-1.4*mu),1.5);
  vec3 light=vec3(0.);float extinction=.35*strength/extent;
  for(int i=0;i<12;i++){
    if(float(i)>=samples)break;
    vec3 point=origin+ray*(start+(float(i)+.5)*stepLength);
    float height=max(0.,length(point)-1.),density=exp(-height/(extent*.22));
    density*=1.-smoothstep(extent*.8,extent,height);
    float optical=density*stepLength*extinction;
    float day=smoothstep(-.12,.18,dot(normalize(point),sun));
    float sunProjection=dot(point,sun),sunMiss=length(point-sun*sunProjection);
    float sunlightVisible=sunProjection>=0.?1.:smoothstep(.99,1.035,sunMiss);
    vec3 scatter=tint*(rayleigh*(.05+day*sunlightVisible)*2.1);
    scatter+=mix(tint,vec3(1.,.66,.32),.75)*mie*day*sunlightVisible;
    light+=exp(-depth)*scatter*(1.-exp(-optical));depth+=optical;
  }
  float alpha=1.-exp(-depth);if(alpha<.0005)discard;
  gl_FragColor=vec4(light/max(.0005,alpha),alpha);
  // Test against the front of the volume, rather than its back-facing shell.
  // This keeps the haze over the limb while nearer rings/bodies occlude it.
  vec4 front=projectionMatrix*viewMatrix*vec4(centre+radius*(origin+ray*start),1.);
  gl_FragDepth=clamp(front.z/front.w*.5+.5,0.,1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function createPlanetAtmosphere(){
  const material=new THREE.ShaderMaterial({uniforms:{centre:{value:new THREE.Vector3()},radius:{value:1},extent:{value:.08},tint:{value:new THREE.Color('#66baff')},strength:{value:1.2},sunlight:{value:new THREE.Vector3(1,1,0)},samples:{value:12}},vertexShader:'varying vec3 worldExit;void main(){worldExit=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(worldExit,1.);}',fragmentShader:fragment,transparent:true,depthWrite:false,side:THREE.BackSide});
  const mesh=new THREE.Mesh(new THREE.SphereGeometry(1,48,32),material);mesh.name='planet-atmosphere';mesh.renderOrder=1;return mesh;
}

export function updatePlanetAtmosphere(mesh:THREE.Mesh,body:SkyBody,sun:{x:number;y:number;z:number},high:boolean){
  const air=body.air??newAtmosphere(),u=(mesh.material as THREE.ShaderMaterial).uniforms;
  mesh.visible=body.atmosphere&&air.strength>0;mesh.scale.setScalar(1+air.extent);
  u.centre.value.copy(mesh.parent!.position);u.radius.value=skyBodyRadius(body);
  u.extent.value=air.extent;u.strength.value=air.strength;u.tint.value.set(air.color);u.sunlight.value.copy(sun);u.samples.value=high?12:8;
}
