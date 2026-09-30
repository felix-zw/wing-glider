import * as THREE from 'three';
import {createSkyBody,updateSkyBody} from './sky-body';
import {RingParticles} from './planet-ring';
import {disposeObject} from './assets';
import {direction,lampPulse,coreMask,type LightingDefinition,type LocalLamp} from './lighting';
import {groundHeight,type LevelWorld} from './levels';
import type {LevelDocument} from './level-document';
import type {State} from './simulation';
import {getSculpt} from './sculpt-runtime';
import {transformRockPoint,transformRockNormal} from './rock-surface';

interface Candidate {id:string;position:THREE.Vector3;color:string;power:number;range:number;lamp?:LocalLamp}
interface Slot {light:THREE.PointLight|THREE.SpotLight;id:string|null;power:number}
export class LightingWorld {
  readonly root=new THREE.Group();readonly helpers=new THREE.Group();readonly skyScene=new THREE.Scene();
  readonly skyCamera=new THREE.PerspectiveCamera(65,1,1,50000);
  readonly ringParticles=new RingParticles();
  private config:LightingDefinition={version:1,bodies:[],lamps:[],primary:null};
  private globals=[new THREE.DirectionalLight(),new THREE.DirectionalLight(),new THREE.DirectionalLight()];
  private points:Slot[]=Array.from({length:4},()=>({light:new THREE.PointLight('white',0,30,2),id:null,power:0}));
  private spots:Slot[]=Array.from({length:2},()=>({light:new THREE.SpotLight('white',0,60,Math.PI/6,.4,2),id:null,power:0}));
  private bodies=new Map<string,THREE.Group>();private lamps=new Map<string,THREE.Group>();private glowSources:Candidate[]=[];
  private backdrop=new THREE.Group();
  private rockSignature='';private rockMeshes:unknown[]=[];
  private high=true;private selected:string|null=null;private world!:LevelWorld;private lampSignature='';private bodySignature='';
  constructor(private scene:THREE.Scene,private main:THREE.DirectionalLight){
    this.root.name='level-lighting';this.helpers.name='light-editor-helpers';scene.add(this.root,this.helpers,this.ringParticles.root);
    for(const light of this.globals)scene.add(light,light.target);
    for(const slot of [...this.points,...this.spots]){scene.add(slot.light);if(slot.light instanceof THREE.SpotLight)scene.add(slot.light.target);}
    const shadow=this.spots[0].light as THREE.SpotLight;shadow.castShadow=true;shadow.shadow.mapSize.set(512,512);shadow.shadow.normalBias=.15;
  }
  setQuality(high:boolean){this.high=high;this.ringParticles.high=high;this.ringParticles.set(this.config.bodies);(this.spots[0].light as THREE.SpotLight).castShadow=high;}
  setBackdrop(objects:THREE.Object3D[]){
    disposeObject(this.backdrop);this.backdrop=new THREE.Group();this.skyScene.add(this.backdrop);
    for(const object of objects){
      if(object.userData.skyBackdrop==='clouds'){
        const material=(object as THREE.Mesh).material as THREE.ShaderMaterial;
        material.vertexShader='varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy/750.,1.,1.);}';material.depthTest=false;material.side=THREE.DoubleSide;material.needsUpdate=true;
      }else{const positions=(object as THREE.Points).geometry.getAttribute('position');const v=new THREE.Vector3();for(let i=0;i<positions.count;i++){v.fromBufferAttribute(positions,i).normalize().multiplyScalar(45000);positions.setXYZ(i,v.x,v.y,v.z);}positions.needsUpdate=true;(object as THREE.Points).geometry.computeBoundingSphere();}
      this.backdrop.add(object);
    }
  }
  set(config:LightingDefinition,world:LevelWorld){
    if(this.world?.revision!==world.revision)for(const slot of [...this.points,...this.spots]){slot.id=null;slot.power=slot.light.intensity=0;}
    this.config=structuredClone(config);this.world=world;this.skyScene.background=new THREE.Color(world.theme.background);
    this.ringParticles.set(config.bodies);
    const bs=JSON.stringify(config.bodies.map(b=>[b.id,b.kind]));
    if(bs!==this.bodySignature){for(const body of this.bodies.values())disposeObject(body);this.bodies.clear();this.bodySignature=bs;
      for(const b of config.bodies){const group=createSkyBody(b);this.skyScene.add(group);this.bodies.set(b.id,group);}
    }
    const primary=config.bodies.find(b=>b.id===config.primary),sun=direction(primary?.azimuth??-130,primary?.elevation??40);
    for(const b of config.bodies)updateSkyBody(this.bodies.get(b.id)!,b,this.skyCamera,sun);
    const ls=JSON.stringify(config.lamps.map(p=>[p.id,p.kind]));
    if(ls!==this.lampSignature){for(const lamp of this.lamps.values())disposeObject(lamp);this.lamps.clear();this.lampSignature=ls;
      for(const p of config.lamps){const lamp=this.makeLamp(p);this.root.add(lamp);this.lamps.set(p.id,lamp);}
    }
    this.select(this.selected);
  }
  private makeLamp(p:LocalLamp){
    const group=new THREE.Group();group.userData.lightId=p.id;
    const metal=new THREE.MeshStandardMaterial({color:'#34454d',metalness:.72,roughness:.4});
    const glow=new THREE.MeshStandardMaterial({color:p.color,emissive:p.color,emissiveIntensity:3,roughness:.23,metalness:.35});glow.userData.luminous=true;
    const add=(geometry:THREE.BufferGeometry,material:THREE.Material,y=0)=>{const m=new THREE.Mesh(geometry,material);m.position.y=y;m.castShadow=m.receiveShadow=true;m.userData.lightId=p.id;group.add(m);return m;};
    add(new THREE.CylinderGeometry(.7,1.4,.6,8),metal,-1.4);add(new THREE.CylinderGeometry(.22,.3,2.4,8),metal,-.3);
    if(p.kind==='reactor'){add(new THREE.IcosahedronGeometry(1.5,1),glow,.7);for(let i=0;i<3;i++){const ring=add(new THREE.TorusGeometry(1.85,.16,6,24),metal,.7);ring.rotation.set(i*.8,i*1.1,.3);}}
    else if(p.kind==='floodlight'){const head=add(new THREE.BoxGeometry(2.6,1.8,1.2),metal,.5);head.name='lamp-head';head.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),new THREE.Vector3(...Object.values(direction(p.azimuth,p.elevation))));const face=add(new THREE.BoxGeometry(2.2,1.4,.13),glow,.5);face.name='lamp-face';}
    else {add(new THREE.CylinderGeometry(.65,.65,p.kind==='beacon'?1.7:.8,12),glow,.5);add(new THREE.CylinderGeometry(.85,.75,.25,8),metal,1.5);}
    return group;
  }
  select(id:string|null){this.selected=id;disposeObject(this.helpers);this.scene.add(this.helpers);const p=this.config.lamps.find(l=>l.id===id);if(!p)return;
    const group=new THREE.Group(),mat=new THREE.LineBasicMaterial({color:p.color,transparent:true,opacity:.4,depthTest:false});
    const points:THREE.Vector3[]=[];for(let i=0;i<=64;i++)points.push(new THREE.Vector3(Math.cos(i*Math.PI/32)*p.range,0,Math.sin(i*Math.PI/32)*p.range));
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),mat));
    if(p.kind==='floodlight'){const dir=new THREE.Vector3().copy(direction(p.azimuth,p.elevation)),end=dir.clone().multiplyScalar(p.range),q=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),dir.normalize()),r=Math.tan(p.angle*Math.PI/180)*p.range;
      const outline:THREE.Vector3[]=[];for(let i=0;i<=32;i++){const a=i*Math.PI/16;outline.push(new THREE.Vector3(Math.cos(a)*r,Math.sin(a)*r,0).applyQuaternion(q).add(end));}
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(outline),mat));for(let i=0;i<32;i+=8)group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),outline[i]]),mat));
    }
    group.position.copy(this.lampPosition(p));this.helpers.add(group);
  }
  private lampPosition(p:LocalLamp){return new THREE.Vector3(p.x,groundHeight(this.world,p.x,p.z)+(this.world.definition.environment==='space'?3.2:0)+p.height,p.z);}
  /** Only exposed emissive surfaces become light proxies: never the sealed core centre. */
  setRockSources(doc:LevelDocument){
    const signature=JSON.stringify(doc.objects.map(o=>[o.id,o.x,o.z,o.rotation,o.scale,o.parameters.sculptId,doc.sculpts?.[String(o.parameters.sculptId)]?.glow])),meshes=doc.objects.map(o=>getSculpt(doc.id,o.id)?.high);
    if(signature===this.rockSignature&&meshes.every((m,i)=>m===this.rockMeshes[i]))return;this.rockSignature=signature;this.rockMeshes=meshes;
    this.glowSources=[];
    for(const object of doc.objects){const source=doc.sculpts?.[String(object.parameters.sculptId)],g=source?.glow,mesh=getSculpt(doc.id,object.id)?.high,host=this.world.solids.find(s=>s.id===object.id);if(!g||!mesh||!host)continue;
      const candidates:{i:number;weight:number;core:number}[]=[];
      for(let i=0;i<mesh.positions.length;i+=3){const core=coreMask(g,mesh.positions.slice(i,i+3)),weight=core*g.core.intensity+(mesh.glow?.[i/3]??0)*g.intensity;if(weight>.03)candidates.push({i,weight,core});}
      candidates.sort((a,b)=>b.weight-a.weight);const used:THREE.Vector3[]=[];
      for(const c of candidates){const local=mesh.positions.slice(c.i,c.i+3),pos=new THREE.Vector3(...local);if(used.some(p=>p.distanceTo(pos)<12))continue;used.push(pos);
        const n=transformRockNormal(host,mesh.normals.slice(c.i,c.i+3)),point=transformRockPoint(host,local);this.glowSources.push({id:'rock-glow-'+object.id+'-'+used.length,position:new THREE.Vector3(point.x+n.x*1.5,point.y+n.y*1.5,point.z+n.z*1.5),color:c.core>.1?g.core.color:g.color,power:c.weight*14,range:16});if(used.length>=4)break;}
    }
  }
  update(camera:THREE.Camera,focus:THREE.Vector3,time:number,dt:number,state:State,storm=0){
    this.skyCamera.quaternion.copy(camera.quaternion);this.skyCamera.aspect=(camera as THREE.OrthographicCamera).right/(camera as THREE.OrthographicCamera).top;this.skyCamera.updateProjectionMatrix();this.skyCamera.updateMatrixWorld();
    const primary=this.config.bodies.find(b=>b.id===this.config.primary&&b.illuminates),sunDirection=direction(primary?.azimuth??-130,primary?.elevation??40);
    const active=this.config.bodies.filter(b=>b.illuminates&&b!==primary),all=primary?[primary,...active.slice(0,3)]:active.slice(0,4);this.main.castShadow=!!primary;
    [this.main,...this.globals].forEach((light,i)=>{const b=all[i];light.intensity=b?Math.max(0,b.intensity-(i===0?storm*1.7:0)):0;if(!b)return;light.color.set(b.color);const d=direction(b.azimuth,b.elevation);light.position.set(focus.x+d.x*210,focus.y+d.y*210,focus.z+d.z*210);light.target.position.copy(focus);light.target.updateMatrixWorld();});
    for(const b of this.config.bodies)updateSkyBody(this.bodies.get(b.id)!,b,this.skyCamera,sunDirection,time,this.high,focus);
    const dustLight=new THREE.Color(.18,.22,.3);for(const b of all)dustLight.add(new THREE.Color(b.color).multiplyScalar(Math.min(2,b.intensity)*.35));
    this.ringParticles.update(focus,time,Math.min(devicePixelRatio,this.high?1.5:1),dustLight,sunDirection);
    const candidates:Candidate[]=[...this.glowSources];
    for(const p of this.config.lamps){const lamp=this.lamps.get(p.id)!,pos=this.lampPosition(p),pulse=lampPulse(p.pattern,time);lamp.position.copy(pos);
      lamp.traverse(o=>{if(o instanceof THREE.Mesh){const m=o.material as THREE.MeshStandardMaterial;if(m.userData.luminous){m.color.set(p.color);m.emissive.set(p.color);m.emissiveIntensity=(p.intensity>0?1+Math.sqrt(p.intensity)*.25:0)*pulse;}}});
      if(p.kind==='floodlight'){const dir=new THREE.Vector3().copy(direction(p.azimuth,p.elevation)),face=lamp.getObjectByName('lamp-face')!;face.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),dir);lamp.getObjectByName('lamp-head')!.quaternion.copy(face.quaternion);face.position.copy(dir.multiplyScalar(.67));face.position.y+=.5;}
      candidates.push({id:p.id,position:pos,color:p.color,power:p.intensity*pulse,range:p.range,lamp:p});
    }
    for(const ore of state.resources.deposits){if(!ore.emission?.intensity||ore.remaining<=0)continue;const cell=ore.surface?.cells?.find(c=>c.valid&&c.mass>0);if(ore.surface?.cells&&!cell)continue;
      const surface=ore.surface!,position=cell?new THREE.Vector3(cell.x+cell.normal.x,cell.y+cell.normal.y,cell.z+cell.normal.z):new THREE.Vector3(ore.x,surface.y+1,ore.z);
      candidates.push({id:'ore-glow-'+ore.id,position,color:ore.emission.color,power:ore.emission.intensity*12*(cell?cell.mass/cell.initialMass:ore.remaining/(ore.initialAmount??12)),range:14});
    }
    this.assign(this.points,candidates.filter(c=>c.lamp?.kind!=='floodlight'),focus,dt,this.high?4:2);
    this.assign(this.spots,candidates.filter(c=>c.lamp?.kind==='floodlight'),focus,dt,this.high?2:1);
  }
  private assign(slots:Slot[],candidates:Candidate[],focus:THREE.Vector3,dt:number,limit:number){
    const score=(c:Candidate)=>c.power/(25+c.position.distanceToSquared(focus))*(slots.some(s=>s.id===c.id)?1.2:1);
    const selected=candidates.filter(c=>c.power>0&&c.position.distanceTo(focus)<c.range+150).sort((a,b)=>score(b)-score(a)).slice(0,limit);
    const reserved=new Set(slots.map(s=>s.id).filter(id=>selected.some(c=>c.id===id)));
    slots.forEach((slot,index)=>{let c=index<limit?selected.find(c=>c.id===slot.id):undefined;
      if(!c){slot.power*=Math.exp(-Math.max(dt,.016)*12);slot.light.intensity=slot.power;if(slot.power>.1)return;slot.id=null;c=index<limit?selected.find(c=>!reserved.has(c.id)):undefined;if(c){slot.id=c.id;reserved.add(c.id);}}
      if(!c){slot.light.intensity=0;return;}slot.power+=(c.power-slot.power)*(1-Math.exp(-Math.max(dt,.016)*10));slot.light.intensity=slot.power;slot.light.position.copy(c.position);slot.light.color.set(c.color);slot.light.distance=c.range;
      if(slot.light instanceof THREE.SpotLight&&c.lamp){const d=direction(c.lamp.azimuth,c.lamp.elevation);slot.light.angle=c.lamp.angle*Math.PI/180;slot.light.target.position.copy(c.position).add(new THREE.Vector3(d.x,d.y,d.z));slot.light.target.updateMatrixWorld();}
    });
  }
  get objects(){return [...this.lamps.values()];}
  get stats(){return {point:this.points.filter(s=>s.light.intensity>.1).length,spot:this.spots.filter(s=>s.light.intensity>.1).length};}
  dispose(){this.ringParticles.dispose();disposeObject(this.backdrop);disposeObject(this.root);disposeObject(this.helpers);for(const b of this.bodies.values())disposeObject(b);for(const l of this.globals){l.removeFromParent();l.target.removeFromParent();}for(const s of [...this.points,...this.spots]){s.light.removeFromParent();s.light.dispose();if(s.light instanceof THREE.SpotLight)s.light.target.removeFromParent();}}
}
