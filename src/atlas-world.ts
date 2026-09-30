import * as THREE from 'three';
import { ATLAS, atlasPlacement, atlasPoint, solveLeg, mix, smooth, type Vec3 } from './atlas-rig';
import { deploymentFrame, type DeploymentState } from './deployment';
import { groundHeight, type LevelWorld } from './levels';
import type { AssetLibrary } from './assets';

/** Owns level-local rig transforms and bounded effects; model buffers stay shared. */
export class AtlasWorld {
  readonly root=new THREE.Group();
  readonly ship:THREE.Group;
  private nodes=new Map<string,THREE.Object3D>();
  private jets:{mesh:THREE.Mesh;kind:'lift'|'brake'|'cruise'}[]=[];
  private dust=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,1),new THREE.MeshBasicMaterial({color:'#bdb193',transparent:true,opacity:.15,depthWrite:false}),64);
  private light=new THREE.PointLight('#97ffde',0,28,2);
  private marker=new THREE.Group();
  private dummy=new THREE.Object3D();
  private up=new THREE.Vector3(0,1,0);
  private delta=new THREE.Vector3();
  private high=true;
  private placement;
  constructor(private world:LevelWorld,assets:AssetLibrary) {
    this.placement=atlasPlacement(world);this.ship=assets.instantiate('atlas');this.ship.name='ATLAS';
    this.ship.traverse(n=>this.nodes.set(n.name,n));
    this.root.add(this.ship,this.dust,this.light,this.marker);
    this.dust.name='atlas-touchdown-dust';this.dust.frustumCulled=false;this.dust.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const geometry=new THREE.ConeGeometry(.75,4,14);geometry.translate(0,2,0);
    const material=new THREE.MeshBasicMaterial({color:new THREE.Color('#82ffde').multiplyScalar(2.5),transparent:true,opacity:.65,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false});
    for(const [name,node] of this.nodes) {
      const kind=name.startsWith('lift_')?'lift':name.startsWith('brake_')?'brake':name.startsWith('cruise_')?'cruise':null;
      if(!kind)continue;
      const flame=new THREE.Mesh(geometry,material);flame.name='atlas-flame-'+name;
      if(kind==='lift')flame.rotation.z=Math.PI;
      else flame.rotation.x=kind==='brake'?-Math.PI/2:Math.PI/2;
      node.add(flame);this.jets.push({mesh:flame,kind});
    }
    const zone=new THREE.Mesh(new THREE.RingGeometry(world.base.radius-.13,world.base.radius,96),
      new THREE.MeshBasicMaterial({color:new THREE.Color('#efc67f').multiplyScalar(2.2),transparent:true,opacity:.85,side:THREE.DoubleSide,depthWrite:false,toneMapped:false}));
    zone.rotation.x=-Math.PI/2;zone.position.set(world.base.x,groundHeight(world,world.base.x,world.base.z)+.17,world.base.z);this.marker.add(zone);
    const label=document.createElement('canvas');label.width=384;label.height=64;
    const ctx=label.getContext('2d')!;ctx.fillStyle='#081519cc';ctx.fillRect(0,4,384,52);ctx.fillStyle='#efc67f';ctx.font='500 23px Arial';ctx.textAlign='center';ctx.fillText('ATLAS / FRACHT',192,38);
    const texture=new THREE.CanvasTexture(label);texture.colorSpace=THREE.SRGBColorSpace;
    const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,depthTest:false,depthWrite:false,toneMapped:false}));
    sprite.scale.set(13,2.17,1);sprite.position.set(this.placement.x,this.placement.height+10,this.placement.z-9);this.marker.add(sprite);
    this.render(null);
  }
  setQuality(quality:'high'|'standard'){this.high=quality==='high';}
  private node(name:string) { const n=this.nodes.get(name);if(!n)throw new Error('ATLAS rig missing '+name);return n; }
  private segment(name:string,a:Vec3,b:Vec3,offset=0) {
    const node=this.node(name);node.position.set(a.x,a.y,a.z+offset);
    this.delta.set(b.x-a.x,b.y-a.y,b.z-a.z);node.quaternion.setFromUnitVectors(this.up,this.delta.clone().normalize());
    node.scale.set(1,this.delta.length(),1);
  }
  render(deployment:DeploymentState|null) {
    const p=this.placement,space=this.world.definition.environment==='space',t=deployment?.time??8,f=deploymentFrame(this.world,t);
    this.ship.position.set(p.x+f.shipOffset.x,p.height+f.shipOffset.y,p.z+f.shipOffset.z);this.ship.rotation.y=p.yaw;
    this.node('hangar_door').position.y=f.door*5.1;
    const hinge=this.node('ramp_hinge');hinge.rotation.x=mix(-Math.PI/2,p.rampAngle,f.ramp);
    hinge.position.z=mix(10.4,10,f.ramp);
    const length=mix(5,p.rampLength,f.ramp);
    for(let i=0;i<4;i++)this.node('ramp_section_'+i).position.z=i*(length-5)/3;
    for(const side of [-1,1])for(const [index,z] of ATLAS.legZ.entries()) {
      const id=`${side<0?'left':'right'}_${index===0?'front':'aft'}`,target=p.feet.find(foot=>foot.id===id);
      const gear=space?0:f.gear;
      const ankle={x:side*mix(6.6,ATLAS.footX,gear),y:target?Math.max(target.ankle.y-f.shipOffset.y,mix(-.65,-7.6,gear)):-.65,z};
      const joint={...ankle,y:ankle.y+.5},solution=solveLeg(side,z,joint);
      const knee=solution.knee;
      this.segment('upper_'+id,solution.hip,knee);
      this.segment('lower_'+id,knee,joint);
      this.segment('piston_'+id,knee,joint,.34);
      this.node('knee_'+id).position.set(knee.x,knee.y,knee.z);
      const foot=this.node('foot_'+id);foot.position.set(ankle.x,ankle.y,ankle.z);
      foot.rotation.set((target?.pitch??0)*gear,0,(target?.roll??0)*gear,'YXZ');
    }
    for(const jet of this.jets) {
      const force=jet.kind==='lift'?f.lift:jet.kind==='brake'?f.brake:space&&t<2.5?.2*(1-smooth(t/2.5)):0;
      jet.mesh.visible=force>.015;jet.mesh.scale.setScalar(.45+force*.55);jet.mesh.scale.y=(.25+force)*(1+Math.sin(t*35)*.035);
    }
    this.light.position.copy(this.ship.position);this.light.position.y-=1;this.light.intensity=this.high?f.lift*35+f.brake*15:0;
    const dustPower=space?0:f.lift*smooth((t-.8)/1.1)*(1-smooth((t-2.3)/.6));
    this.dust.visible=dustPower>.005;this.dust.count=this.high?64:24;
    this.dust.material.opacity=dustPower*.16;
    if(this.dust.visible)for(let i=0;i<this.dust.count;i++) {
      const side=i%2?1:-1,z=i%4<2?-5.5:5.5,a=i*2.399963,age=(t*1.1+i*.137)%1;
      const at=atlasPoint(p,side*6.65+Math.sin(a)*age*13,0,z+Math.cos(a)*age*13);
      this.dummy.position.set(at.x,groundHeight(this.world,at.x,at.z)+.4+age*1.7,at.z);
      this.dummy.rotation.set(i,i*.7,i*.3);this.dummy.scale.setScalar(.5+age*2.6);this.dummy.scale.y*=.32;this.dummy.updateMatrix();this.dust.setMatrixAt(i,this.dummy.matrix);
    }
    this.dust.instanceMatrix.needsUpdate=this.dust.visible;
    this.marker.visible=t>=4;
    this.ship.updateMatrixWorld(true);
  }
}
