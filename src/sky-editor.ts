import * as THREE from 'three';
import {disposeObject} from './assets';
import {direction,skyBodyRadius,type SkyBody} from './lighting';
import {createSkyBody,updateSkyBody} from './sky-body';
import {clampSkyDistance,pointOnHemisphere,skyAngles,type Hemisphere} from './sky-editor-math';
import type {LevelDocument} from './level-document';
import {gameViewAngles} from './game-camera';
import {ringFrame,RingParticles} from './planet-ring';

interface SkyCallbacks {select:(id:string)=>void;preview:(body:SkyBody)=>void;commit:(body:SkyBody)=>void;restore:()=>void}
interface Gesture {pointer:number;kind:'body'|'distance'|'ring'|'orbit'|'pan';x:number;y:number;body?:SkyBody;previous:THREE.Vector3;offset:THREE.Vector2;yaw:number;pitch:number;target:THREE.Vector3;axis:THREE.Vector2;units:number;ringAxis?:THREE.Vector3;ringStart?:THREE.Vector3}

/** Spatial editing only. The authored document and global history remain in LevelEditor. */
export class SkyEditor {
  readonly scene=new THREE.Scene();readonly camera=new THREE.PerspectiveCamera(48,1,1,150000);
  side:Hemisphere=1;radius=1000;preview=false;ringMode=false;private high=true;
  private yaw=.7;private pitch=.48;private distance=3000;private target=new THREE.Vector3();
  private dome=new THREE.Group();private miniature=new THREE.Group();private radial=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3(1,0,0)]),new THREE.LineBasicMaterial({color:'#ffe1a1',transparent:true,opacity:.7}));
  readonly distanceHandle=new THREE.Mesh(new THREE.OctahedronGeometry(1),new THREE.MeshBasicMaterial({color:'#ffe1a1',depthTest:false}));
  private bodies=new Map<string,THREE.Group>();private labels=new Map<string,HTMLSpanElement>();
  private doc!:LevelDocument;private selection:string|null=null;private region:HTMLElement|null=null;private labelRoot:HTMLElement|null=null;
  private gesture:Gesture|null=null;private draft:SkyBody|null=null;private ray=new THREE.Raycaster();
  private miniatureSignature='';private right=new THREE.Vector3(1,0,0);
  private ringHandles=new THREE.Group();private ringPaths:THREE.Vector3[][]=[];
  private ringParticles=new RingParticles();private ringSignature='';
  constructor(private callbacks:SkyCallbacks){
    this.scene.background=new THREE.Color('#060e19');
    const shell=new THREE.Mesh(new THREE.SphereGeometry(1,48,24,0,Math.PI*2,0,Math.PI/2),new THREE.MeshBasicMaterial({color:'#63adc3',transparent:true,opacity:.035,side:THREE.DoubleSide,depthWrite:false}));
    this.dome.add(shell);
    const grid:number[]=[],edge:number[]=[];
    const segment=(out:number[],a:THREE.Vector3,b:THREE.Vector3)=>out.push(a.x,a.y,a.z,b.x,b.y,b.z);
    const at=(a:number,e:number)=>new THREE.Vector3(Math.cos(a)*Math.cos(e),Math.sin(e),Math.sin(a)*Math.cos(e));
    for(let j=0;j<4;j++)for(let i=0;i<96;i++)segment(j===0?edge:grid,at(i/96*Math.PI*2,j*Math.PI/8),at((i+1)/96*Math.PI*2,j*Math.PI/8));
    for(let j=0;j<12;j++)for(let i=0;i<24;i++)segment(grid,at(j/12*Math.PI*2,i/24*Math.PI/2),at(j/12*Math.PI*2,(i+1)/24*Math.PI/2));
    for(const [data,color,opacity] of [[grid,'#4c8da7',.32],[edge,'#9cd3dc',.85]] as const){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(data,3));this.dome.add(new THREE.LineSegments(g,new THREE.LineBasicMaterial({color,transparent:true,opacity,depthWrite:false})));}
    for(const [i,color] of ['#ff6c65','#83e9a0','#70b4ff'].entries()){const points:THREE.Vector3[]=[];for(let j=0;j<=128;j++){const a=j/128*Math.PI*2,c=Math.cos(a),s=Math.sin(a);points.push(i===0?new THREE.Vector3(0,c,s):i===1?new THREE.Vector3(c,0,s):new THREE.Vector3(c,s,0));}this.ringPaths.push(points);const handle=new THREE.Mesh(new THREE.TorusGeometry(1,.007,6,128),new THREE.MeshBasicMaterial({color,depthTest:false,depthWrite:false,transparent:true,opacity:.95}));if(i===0)handle.rotation.y=Math.PI/2;else if(i===1)handle.rotation.x=Math.PI/2;handle.renderOrder=20;this.ringHandles.add(handle);}
    this.distanceHandle.renderOrder=10;this.scene.add(this.dome,this.miniature,this.radial,this.distanceHandle,this.ringHandles,this.ringParticles.root);
  }
  get dragging(){return !!this.gesture;}
  get editing(){return this.gesture?.kind==='body'||this.gesture?.kind==='distance'||this.gesture?.kind==='ring';}
  bind(region:HTMLElement|null){
    this.region=region;this.labelRoot=region?.querySelector('#sky-labels')??null;
    if(this.labelRoot)for(const label of this.labels.values())this.labelRoot.append(label);
  }
  reset(){this.cancel();this.preview=false;this.ringMode=false;this.side=1;this.yaw=.7;this.pitch=.48;this.distance=3000;this.target.set(0,0,0);this.selection=null;this.miniatureSignature='';}
  sync(doc:LevelDocument,selection:string|null){
    this.doc=doc;
    const selected=doc.lighting!.bodies.find(b=>b.id===selection),changed=selection!==this.selection;
    this.selection=selection;
    if(changed||!selected?.ring?.enabled)this.ringMode=false;
    const ids=new Set(doc.lighting!.bodies.map(b=>b.id));
    for(const [id,group] of this.bodies)if(!ids.has(id)||doc.lighting!.bodies.find(b=>b.id===id)?.kind!==group.userData.kind){disposeObject(group);this.bodies.delete(id);this.labels.get(id)?.remove();this.labels.delete(id);}
    for(const b of doc.lighting!.bodies)if(!this.bodies.has(b.id)){
      const group=createSkyBody(b);group.userData.kind=b.kind;this.bodies.set(b.id,group);this.scene.add(group);
      const label=document.createElement('span');label.className='sky-body-label';this.labels.set(b.id,label);this.labelRoot?.append(label);
    }
    // Miniature rebuilds only when the level layout changes, never on a light drag.
    const signature=JSON.stringify([doc.bounds,doc.spawn,doc.base,doc.objects,doc.shelters]);
    if(signature!==this.miniatureSignature){this.miniatureSignature=signature;this.buildMiniature();}
    this.radius=selected?.distance??1000;
    if(selected&&!this.dragging&&selected.elevation!==0&&selected.elevation*this.side<0)this.setSide(selected.elevation<0?-1:1);
    if(changed&&selected){this.side=selected.elevation<0?-1:1;this.pitch=Math.abs(this.pitch)*this.side;this.fit();}
    this.update();
  }
  private buildMiniature(){
    disposeObject(this.miniature);this.miniature=new THREE.Group();this.scene.add(this.miniature);
    const d=this.doc,positions:number[]=[];
    const line=(a:THREE.Vector3,b:THREE.Vector3)=>positions.push(a.x,a.y,a.z,b.x,b.y,b.z);
    const corners=[[-d.bounds,-d.bounds],[d.bounds,-d.bounds],[d.bounds,d.bounds],[-d.bounds,d.bounds]];
    for(let i=0;i<4;i++)line(new THREE.Vector3(corners[i][0],0,corners[i][1]),new THREE.Vector3(corners[(i+1)%4][0],0,corners[(i+1)%4][1]));
    line(new THREE.Vector3(-d.bounds,0,0),new THREE.Vector3(d.bounds,0,0));line(new THREE.Vector3(0,0,-d.bounds),new THREE.Vector3(0,0,d.bounds));
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));this.miniature.add(new THREE.LineSegments(g,new THREE.LineBasicMaterial({color:'#50716e'})));
    for(const [p,color,size] of [[d.spawn,'#9ee4ba',7],[d.base,'#f3d8a4',10]] as const){const m=new THREE.Mesh(new THREE.OctahedronGeometry(size),new THREE.MeshBasicMaterial({color}));m.position.set(p.x,0,p.z);this.miniature.add(m);}
    const origin=new THREE.Mesh(new THREE.SphereGeometry(6,12,8),new THREE.MeshBasicMaterial({color:'#b9dde7'}));this.miniature.add(origin);
    for(const o of d.objects){const m=new THREE.Mesh(new THREE.IcosahedronGeometry(8*o.scale),new THREE.MeshBasicMaterial({color:'#35535d',wireframe:true}));m.position.set(o.x,0,o.z);this.miniature.add(m);}
  }
  fit(){
    const rect=this.rect(),aspect=rect?.width&&rect.height?rect.width/rect.height:1;
    const fov=this.camera.fov*Math.PI/180,angle=Math.min(fov/2,Math.atan(Math.tan(fov/2)*aspect));
    const bounds=new THREE.Box3(new THREE.Vector3(-this.radius,Math.min(0,this.side*this.radius),-this.radius),new THREE.Vector3(this.radius,Math.max(0,this.side*this.radius),this.radius));
    const body=this.doc?.lighting!.bodies.find(b=>b.id===this.selection);if(body){const center=ringFrame(body).center,extent=skyBodyRadius(body)*Math.max(1,body.ring?.enabled?body.ring.outer:1,body.kind==='sun'?1+(body.corona?.extent??.55):1);bounds.expandByPoint(center.clone().addScalar(extent));bounds.expandByPoint(center.clone().addScalar(-extent));}
    bounds.expandByPoint(new THREE.Vector3(-this.doc.bounds,0,-this.doc.bounds));bounds.expandByPoint(new THREE.Vector3(this.doc.bounds,0,this.doc.bounds));
    const center=bounds.getCenter(new THREE.Vector3()),extent=bounds.getSize(new THREE.Vector3()).length()/2;
    this.distance=extent/Math.sin(angle)*1.1;this.target.copy(center);this.updateCamera();
  }
  gameAngle(){this.cancel();Object.assign(this,gameViewAngles());this.fit();this.update();}
  setPreview(value:boolean){this.cancel();this.preview=value;if(value)this.ringMode=false;}
  alignRing(value:boolean){this.cancel();this.preview=false;this.ringMode=value;this.update();}
  focus(){const body=this.doc?.lighting!.bodies.find(b=>b.id===this.selection);if(!body)return;this.cancel();this.side=body.elevation<0?-1:1;this.pitch=Math.abs(this.pitch)*this.side;this.fit();this.update();}
  setSide(side:Hemisphere){this.cancel();this.side=side;this.pitch=Math.abs(this.pitch)*side;this.target.y=Math.abs(this.target.y)*side;this.update();}
  private rect(){return this.region?.getBoundingClientRect();}
  private updateCamera(){
    const r=this.rect();if(r?.width&&r.height){this.camera.aspect=r.width/r.height;this.camera.updateProjectionMatrix();}
    this.camera.position.set(Math.cos(this.yaw)*Math.cos(this.pitch),Math.sin(this.pitch),Math.sin(this.yaw)*Math.cos(this.pitch)).multiplyScalar(this.distance).add(this.target);
    this.camera.lookAt(this.target);this.camera.updateMatrixWorld();this.right.set(1,0,0).applyQuaternion(this.camera.quaternion).setY(0).normalize();
  }
  private update(){
    this.updateCamera();this.dome.scale.set(this.radius,this.radius*this.side,this.radius);
    this.distanceHandle.position.copy(this.right).multiplyScalar(this.radius);this.distanceHandle.scale.setScalar(this.unitsPerPixel(this.distanceHandle.position)*11);
    const primary=this.doc?.lighting!.bodies.find(b=>b.id===this.doc.lighting!.primary),sun=direction(primary?.azimuth??-130,primary?.elevation??40);
    const bodies=(this.doc?.lighting!.bodies??[]).map(b=>this.draft?.id===b.id?this.draft:b),time=performance.now()/1000;
    for(const body of bodies){const group=this.bodies.get(body.id)!;updateSkyBody(group,body,this.camera,sun,time,this.high,this.camera.position);}
    const signature=JSON.stringify([this.high,bodies]);if(signature!==this.ringSignature){this.ringSignature=signature;this.ringParticles.high=this.high;this.ringParticles.set(bodies);}
    this.ringParticles.update(this.camera.position,time,1,new THREE.Color(.85,.9,1),sun);
    const selected=this.draft??this.doc?.lighting!.bodies.find(b=>b.id===this.selection);
    this.radial.visible=!!selected&&!this.ringMode;this.distanceHandle.visible=!!selected&&!this.ringMode;this.ringHandles.visible=!!selected?.ring?.enabled&&this.ringMode;
    if(this.ringHandles.visible){const f=ringFrame(selected!);this.ringHandles.position.copy(f.center);this.ringHandles.scale.setScalar(Math.max(f.radius*selected!.ring!.outer*1.08,this.unitsPerPixel(f.center)*90));}
    if(selected){const p=new THREE.Vector3().copy(direction(selected.azimuth,selected.elevation)).multiplyScalar(this.radius);const a=this.radial.geometry.getAttribute('position') as THREE.BufferAttribute;a.setXYZ(1,p.x,p.y,p.z);a.needsUpdate=true;this.radial.geometry.computeBoundingSphere();}
    this.scene.updateMatrixWorld();this.updateLabels();
  }
  private screen(p:THREE.Vector3){const r=this.rect()!,v=p.clone().project(this.camera);return {x:r.left+(v.x+1)*r.width/2,y:r.top+(1-v.y)*r.height/2,z:v.z};}
  private unitsPerPixel(p:THREE.Vector3){const z=-p.clone().applyMatrix4(this.camera.matrixWorldInverse).z;return Math.max(1,z)*2*Math.tan(this.camera.fov*Math.PI/360)/(this.rect()?.height??800);}
  private updateLabels(){
    const r=this.rect();if(!r)return;
    for(const b of this.doc.lighting!.bodies){const body=this.draft?.id===b.id?this.draft:b,group=this.bodies.get(b.id)!,label=this.labels.get(b.id)!,p=this.screen(group.position),inHalf=body.elevation*this.side>=0;
      label.hidden=p.z<-1||p.z>1||p.x<r.left||p.x>r.right||p.y<r.top||p.y>r.bottom;
      label.style.left=p.x-r.left+'px';label.style.top=p.y-r.top+'px';label.classList.toggle('selected',b.id===this.selection);label.classList.toggle('other-half',!inHalf);
      label.textContent=(b.kind==='sun'?'☀ ':'◉ ')+body.name+(body.visible?'':' · unsichtbar')+(!inHalf?' · andere Seite':'');
    }
    const readout=this.region?.querySelector('#sky-distance-readout');if(readout)readout.textContent=Math.round(this.radius).toLocaleString('de-DE')+' m';
    const handleLabel=this.region?.querySelector<HTMLElement>('#sky-handle-label');if(handleLabel){const p=this.screen(this.distanceHandle.position);handleLabel.hidden=!this.distanceHandle.visible||p.z<-1||p.z>1;handleLabel.style.left=p.x-r.left+'px';handleLabel.style.top=p.y-r.top+'px';}
    for(const [id,p] of [['sky-origin-label',new THREE.Vector3()],['sky-atlas-label',new THREE.Vector3(this.doc.base.x,0,this.doc.base.z)],['sky-spawn-label',new THREE.Vector3(this.doc.spawn.x,0,this.doc.spawn.z)]] as const){const label=this.region?.querySelector<HTMLElement>('#'+id);if(label){const s=this.screen(p);label.hidden=s.z<-1||s.z>1;label.style.left=s.x-r.left+'px';label.style.top=s.y-r.top+'px';}}
  }
  wheel(delta:number){if(this.gesture||this.preview)return;this.distance=THREE.MathUtils.clamp(this.distance*Math.exp(delta*.001),25,90000);this.update();}
  private ringVector(x:number,y:number,center:THREE.Vector3,axis:THREE.Vector3){if(Math.abs(this.camera.getWorldDirection(new THREE.Vector3()).dot(axis))<.1)return null;const r=this.rect()!;this.ray.setFromCamera(new THREE.Vector2((x-r.left)/r.width*2-1,1-(y-r.top)/r.height*2),this.camera);const hit=this.ray.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(axis,center),new THREE.Vector3());return hit?.sub(center).normalize()??null;}
  pointerDown(e:PointerEvent){
    if(!this.region||this.gesture||this.preview||e.button===2)return;this.update();const r=this.rect()!;
    if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)return;
    let kind:Gesture['kind']=e.button===1?'pan':'orbit';let body:SkyBody|undefined,offset=new THREE.Vector2(),ringAxis:THREE.Vector3|undefined,ringStart:THREE.Vector3|undefined;
    if(e.button===0&&!e.altKey){
      const handle=this.screen(this.distanceHandle.position);
      if(this.ringMode){let best=13,index=-1;this.ringPaths.forEach((points,i)=>{for(const point of points){const p=this.screen(point.clone().multiplyScalar(this.ringHandles.scale.x).add(this.ringHandles.position)),d=Math.hypot(p.x-e.clientX,p.y-e.clientY);if(p.z>=-1&&p.z<=1&&d<best){best=d;index=i;}}});if(index<0)return;kind='ring';ringAxis=new THREE.Vector3().setComponent(index,1);ringStart=this.ringVector(e.clientX,e.clientY,this.ringHandles.position,ringAxis)??undefined;}
      else if(this.distanceHandle.visible&&Math.hypot(e.clientX-handle.x,e.clientY-handle.y)<23)kind='distance';
      else {
        const hits=this.doc.lighting!.bodies.map(b=>{const group=this.bodies.get(b.id)!,p=this.screen(group.position),size=b.visible?group.scale.x/this.unitsPerPixel(group.position):0;return {b,p,score:Math.hypot(e.clientX-p.x,e.clientY-p.y),size};}).filter(h=>h.p.z>=-1&&h.p.z<=1&&h.score<=Math.max(18,h.size)).sort((a,b)=>a.score-b.score);
        const hit=hits[0];if(!hit)return;
        if(hit.b.id!==this.selection){this.callbacks.select(hit.b.id);return;}
        if(hit.b.elevation*this.side<0)return;
        kind='body';offset.set(e.clientX-hit.p.x,e.clientY-hit.p.y);
      }
      body=this.doc.lighting!.bodies.find(b=>b.id===this.selection);if(!body)return;
      body=structuredClone(body);
    }
    const handle=this.screen(this.distanceHandle.position),next=this.screen(this.distanceHandle.position.clone().add(this.right)),axis=new THREE.Vector2(next.x-handle.x,next.y-handle.y);const units=1/Math.max(1e-8,axis.length());axis.normalize();
    this.gesture={pointer:e.pointerId,kind,x:e.clientX,y:e.clientY,body,previous:body?new THREE.Vector3().copy(direction(body.azimuth,body.elevation)).multiplyScalar(body.distance??1000):new THREE.Vector3(),offset,yaw:this.yaw,pitch:this.pitch,target:this.target.clone(),axis,units,ringAxis,ringStart};
    if(e.isTrusted)(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  pointerMove(e:PointerEvent){
    const g=this.gesture;if(!g||g.pointer!==e.pointerId)return;const dx=e.clientX-g.x,dy=e.clientY-g.y;
    if(g.kind==='orbit'){this.yaw=g.yaw-dx*.006;this.pitch=THREE.MathUtils.clamp(g.pitch+dy*.006,-1.48,1.48);}
    else if(g.kind==='pan'){const up=new THREE.Vector3(0,1,0).applyQuaternion(this.camera.quaternion),units=this.unitsPerPixel(g.target);this.target.copy(g.target).addScaledVector(this.right,-dx*units).addScaledVector(up,dy*units);}
    else {
      const body=structuredClone(g.body!);
      if(g.kind==='distance'){body.distance=clampSkyDistance((g.body!.distance??1000)+(dx*g.axis.x+dy*g.axis.y)*g.units,body);this.radius=body.distance;}
      else if(g.kind==='ring'){const next=this.ringVector(e.clientX,e.clientY,this.ringHandles.position,g.ringAxis!),angle=next&&g.ringStart?Math.atan2(g.ringAxis!.dot(g.ringStart.clone().cross(next)),g.ringStart.dot(next)):(dx-dy)*.008;body.ring!.orientation=new THREE.Quaternion().setFromAxisAngle(g.ringAxis!,angle).multiply(new THREE.Quaternion().fromArray(g.body!.ring!.orientation)).normalize().toArray() as [number,number,number,number];}
      else {const r=this.rect()!;this.ray.setFromCamera(new THREE.Vector2((e.clientX-g.offset.x-r.left)/r.width*2-1,1-(e.clientY-g.offset.y-r.top)/r.height*2),this.camera);const p=pointOnHemisphere(this.ray.ray,this.radius,this.side,g.previous);Object.assign(body,skyAngles(p));g.previous.copy(p);}
      this.draft=body;this.callbacks.preview(body);
    }
    this.update();
  }
  pointerUp(e:PointerEvent){
    if(this.gesture?.pointer!==e.pointerId)return;
    const result=this.draft;this.gesture=null;this.draft=null;
    if(result)this.callbacks.commit(result);
    const canvas=e.currentTarget as HTMLElement;if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);
  }
  cancel(){const editing=this.editing;this.gesture=null;this.draft=null;if(editing){this.callbacks.restore();this.radius=this.doc.lighting!.bodies.find(b=>b.id===this.selection)?.distance??1000;this.update();}return editing;}
  render(renderer:THREE.WebGLRenderer,high=true){
    if(!this.region||!this.doc)return;this.high=high;this.update();const r=this.rect()!,canvas=renderer.domElement.getBoundingClientRect(),size=renderer.getSize(new THREE.Vector2());
    const viewport=renderer.getViewport(new THREE.Vector4()),scissor=renderer.getScissor(new THREE.Vector4()),test=renderer.getScissorTest(),target=renderer.getRenderTarget(),clear=renderer.getClearColor(new THREE.Color()),alpha=renderer.getClearAlpha();
    renderer.setRenderTarget(null);renderer.setScissorTest(false);renderer.setViewport(0,0,size.x,size.y);renderer.setClearColor('#060e19',1);renderer.clear();
    renderer.setViewport((r.left-canvas.left)/canvas.width*size.x,(canvas.bottom-r.bottom)/canvas.height*size.y,r.width/canvas.width*size.x,r.height/canvas.height*size.y);
    renderer.setScissor(renderer.getViewport(new THREE.Vector4()));renderer.setScissorTest(true);renderer.info.reset();renderer.render(this.scene,this.camera);
    renderer.setRenderTarget(target);renderer.setViewport(viewport);renderer.setScissor(scissor);renderer.setScissorTest(test);renderer.setClearColor(clear,alpha);
  }
  dispose(){this.cancel();this.ringParticles.dispose();disposeObject(this.scene);this.bodies.clear();for(const label of this.labels.values())label.remove();this.labels.clear();}
}
