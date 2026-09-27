import * as THREE from 'three';
import { groundHeight, seededRandom, type LevelWorld } from './levels';
import type { State } from './simulation';
import type { Quality } from './render-pipeline';

const dustVertex = `
attribute vec4 cloud;
uniform float time;
uniform vec3 follow;
uniform float terrainSeed;
uniform vec4 hills[6];
uniform vec3 shelters[9];
varying vec2 vUv;
varying vec3 vWorld;
varying float vSeed;
// Same heightfield as levels.groundHeight, sampled at each subdivided cloud vertex.
float terrainHeight(vec2 p) {
  float x=p.x, z=p.y;
  float h=9.0+6.0*sin(x*.025+terrainSeed)*cos(z*.029)
    +3.0*sin(x*.057+z*.038)+1.4*cos(z*.11-x*.045);
  for(int i=0;i<6;i++) {
    vec4 hill=hills[i];
    if(hill.z>0.0) {
      vec2 offset=p-hill.xy;
      float r2=dot(offset,offset)/(hill.z*hill.z);
      if(r2<1.0) h+=hill.w*(1.0-r2)*(1.0-r2);
    }
  }
  for(int i=0;i<9;i++) {
    float d=distance(p,shelters[i].xy);
    if(d<30.0) {
      float t=clamp((d-12.0)/18.0,0.0,1.0);
      h=1.5+(h-1.5)*t*t*(3.0-2.0*t);
    }
  }
  return h;
}
void main() {
  vUv=uv; vSeed=cloud.w;
  vec2 travel=vec2(time*19.0,time*7.0);
  vec2 centre=mod(cloud.xy+travel+vec2(160.0),320.0)-vec2(160.0)+follow.xz;
  vec2 ground=centre+vec2(position.x*(54.0+cloud.w*24.0),position.y*(14.0+cloud.w*8.0));
  vec3 p=vec3(ground.x,terrainHeight(ground)+cloud.z,ground.y);
  vWorld=p;
  gl_Position=projectionMatrix*viewMatrix*vec4(p,1.0);
}`;
const dustFragment = `
uniform float time;
uniform float intensity;
uniform vec3 color;
uniform vec3 shelters[9];
varying vec2 vUv;
varying vec3 vWorld;
varying float vSeed;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.0),f.x),f.y);}
void main(){
  vec2 p=vUv*2.0-1.0;
  float edge=1.0-smoothstep(.2,1.0,dot(p,p));
  float field=noise(vec2(vUv.x*6.0-time*.45+vSeed*20.0,vUv.y*4.0));
  field=field*.7+noise(vUv*17.0+vec2(-time*.6,vSeed*10.0))*.3;
  float safe=1.0;
  for(int i=0;i<9;i++) safe*=smoothstep(shelters[i].z,shelters[i].z+4.0,distance(vWorld.xz,shelters[i].xy));
  float alpha=edge*smoothstep(.28,.82,field)*intensity*.7*mix(.05,1.0,safe);
  if(alpha<.004)discard;
  gl_FragColor=vec4(color,alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Atmosphere {
  readonly root = new THREE.Group();
  private dust: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial> | null = null;
  private wake: THREE.InstancedMesh;
  private particles: { x:number; y:number; z:number; age:number; life:number; scale:number }[] = [];
  private next = 0;
  private emitClock = 0;
  private dummy = new THREE.Object3D();
  private quality: Quality = 'high';
  private smoothed = 0;
  constructor(private world: LevelWorld) {
    const sprite = document.createElement('canvas'); sprite.width=sprite.height=64;
    const ctx=sprite.getContext('2d')!, gradient=ctx.createRadialGradient(32,32,2,32,32,31);
    gradient.addColorStop(0,'rgba(220,206,174,.42)'); gradient.addColorStop(.4,'rgba(220,206,174,.18)'); gradient.addColorStop(1,'rgba(220,206,174,0)');
    ctx.fillStyle=gradient;ctx.fillRect(0,0,64,64);
    const map = new THREE.CanvasTexture(sprite); map.colorSpace=THREE.SRGBColorSpace;
    this.wake = new THREE.InstancedMesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({map,color:'#c6ba98',transparent:true,depthWrite:false,side:THREE.DoubleSide,opacity:.65}),100);
    this.wake.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.wake.frustumCulled=false;this.wake.count=0;this.root.add(this.wake);
    if(world.definition.environment==='space') { this.wake.visible=false; return; }
    const plane=new THREE.PlaneGeometry(1,1,8,3), geo=new THREE.InstancedBufferGeometry(); geo.index=plane.index;
    geo.setAttribute('position',plane.attributes.position);geo.setAttribute('uv',plane.attributes.uv);
    const random=seededRandom(846), clouds=[];
    for(let i=0;i<90;i++)clouds.push(random()*320-160,random()*320-160,1.5+random()*10,random());
    geo.setAttribute('cloud',new THREE.InstancedBufferAttribute(new Float32Array(clouds),4));geo.instanceCount=90;
    const shelters=world.shelters.map(s=>new THREE.Vector3(s.x,s.z,s.radius));
    const hills=world.structures.filter(s=>s.kind==='hill').map(h=>new THREE.Vector4(h.x,h.z,h.radius,h.height));
    const material=new THREE.ShaderMaterial({vertexShader:dustVertex,fragmentShader:dustFragment,transparent:true,depthTest:true,depthWrite:false,side:THREE.DoubleSide,uniforms:{time:{value:0},intensity:{value:0},color:{value:new THREE.Color('#c6ab7e')},follow:{value:new THREE.Vector3()},terrainSeed:{value:world.definition.seed*.001},hills:{value:hills},shelters:{value:shelters}}});
    this.dust=new THREE.Mesh(geo,material);this.dust.frustumCulled=false;this.dust.renderOrder=3;this.root.add(this.dust);
  }
  setQuality(quality: Quality) {this.quality=quality;if(this.dust)this.dust.geometry.instanceCount=quality==='high'?90:48;}
  get intensity(){return this.smoothed;}
  update(state:State,dt:number,thrust:number,follow:THREE.Vector3){
    const target=this.world.definition.environment==='space'?0:state.phase==='storm'?1:state.phase==='warning'?.2:0;
    this.smoothed+=(target-this.smoothed)*(1-Math.exp(-dt*1.5));
    if(this.dust){const u=this.dust.material.uniforms;u.time.value=state.elapsed;u.intensity.value=this.smoothed;u.follow.value.copy(follow);this.dust.visible=this.smoothed>.005;}
    if(this.world.definition.environment==='space')return;
    this.emitClock+=dt;
    const interval=this.quality==='high'?.04:.085;
    if(dt>0&&thrust>0&&state.speed>1&&!state.dead&&this.emitClock>=interval){
      this.emitClock=0;
      const t=state.elapsed, side=Math.sin(t*31)*1.8;
      this.particles[this.next]={x:state.x-Math.sin(state.heading)*3+Math.cos(state.heading)*side,z:state.z+Math.cos(state.heading)*3+Math.sin(state.heading)*side,y:groundHeight(this.world,state.x,state.z)+.35,age:0,life:1.1+Math.sin(t*27)*.25,scale:1+state.speed*.045};this.next=(this.next+1)%100;
    }
    let count=0;
    for(const p of this.particles){p.age+=dt;if(p.age>=p.life)continue;const a=p.age/p.life;p.x+=dt*.7;p.z+=dt*.3;
      this.dummy.position.set(p.x,p.y+a*.7,p.z);this.dummy.rotation.set(-Math.PI/2,0,p.x);this.dummy.scale.setScalar(p.scale*(1+a*3)*(1-a)*2);this.dummy.updateMatrix();this.wake.setMatrixAt(count++,this.dummy.matrix);
    }
    this.wake.count=count;this.wake.instanceMatrix.needsUpdate=true;
  }
}
