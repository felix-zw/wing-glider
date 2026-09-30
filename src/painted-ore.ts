import * as THREE from 'three';
import type {Deposit} from './resources';
import {RESOURCES} from './resources';
import type {LiveOreCell} from './ore-paint';

/** One contiguous batch per ore layer. Per-cell alpha and rooted crystals share mining mass. */
export function createPaintedOre(d:Deposit,mineralGeometry:THREE.BufferGeometry,mineralMaterial:THREE.MeshStandardMaterial){
  const cells=d.surface!.cells!,positions:number[]=[],colors:number[]=[],normals:number[]=[],uv:number[]=[],ranges:number[]=[];
  const pieces:{position:THREE.Vector3;rotation:THREE.Quaternion;scale:THREE.Vector3}[]=[];
  const hash=(n:number)=>{const v=Math.sin(n*127.1+43.7)*43758.5453;return v-Math.floor(v);};
  const tint=new THREE.Color(RESOURCES[d.resource].color),up=new THREE.Vector3(0,1,0),dummy=new THREE.Object3D();
  for(let c=0;c<cells.length;c++){
    const cell=cells[c],n=new THREE.Vector3(cell.normal.x,cell.normal.y,cell.normal.z),q=new THREE.Quaternion().setFromUnitVectors(up,n),p=new THREE.Vector3(cell.x,cell.y,cell.z);
    ranges.push(positions.length/3);
    for(let j=0;j<10;j++)for(const a of [-1,j,j+1]){
      const angle=a*Math.PI/5,r=a<0?0:cell.radius*(1.12+.22*Math.sin(a*7.3+c*13.7));
      const point=new THREE.Vector3(Math.cos(angle)*r,.025,Math.sin(angle)*r).applyQuaternion(q).add(p);
      positions.push(point.x,point.y,point.z);normals.push(n.x,n.y,n.z);colors.push(tint.r,tint.g,tint.b,a<0?.47:.015);uv.push(point.x*.4,point.z*.4);
    }
    for(let j=0;j<3;j++){
      const angle=hash(c*7+j)*Math.PI*2,offset=new THREE.Vector3(Math.cos(angle)*cell.radius*hash(c*11+j)*.75,-.10,Math.sin(angle)*cell.radius*hash(c*13+j)*.75).applyQuaternion(q);
      pieces.push({position:p.clone().add(offset),rotation:q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(up,angle)),scale:new THREE.Vector3(.18+hash(c*3+j)*.8,.22+hash(c*13+j*4)*.85,.24+hash(c*17+j)*.6).multiplyScalar(cell.radius)});
    }
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,4));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  const patch=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({vertexColors:true,color:'white',transparent:true,depthWrite:false,side:THREE.DoubleSide,roughness:.71,metalness:.48,polygonOffset:true,polygonOffsetFactor:-2}));
  const chunks=new THREE.InstancedMesh(mineralGeometry,mineralMaterial.clone(),pieces.length);chunks.castShadow=true;
  chunks.geometry=mineralGeometry.clone();
  const emission=new THREE.InstancedBufferAttribute(new Float32Array(pieces.length).fill(1),1);chunks.geometry.setAttribute('oreEmission',emission);
  const patchEmission=new THREE.BufferAttribute(new Float32Array(positions.length/3).fill(1),1);patch.geometry.setAttribute('oreEmission',patchEmission);
  for(const material of [patch.material,chunks.material]){material.onBeforeCompile=shader=>{
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nattribute float oreEmission;varying float vOreEmission;').replace('#include <begin_vertex>','#include <begin_vertex>\nvOreEmission=oreEmission;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying float vOreEmission;').replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\ntotalEmissiveRadiance*=vOreEmission;');
  };material.customProgramCacheKey=()=> 'ore-emission-v1';}
  if(d.emission){for(const material of [patch.material,chunks.material]){material.emissive.set(d.emission.color);material.emissiveIntensity=d.emission.intensity;}}
  patch.userData.depositId=chunks.userData.depositId=d.id;
  const initialAlpha=geometry.getAttribute('color').array.slice();
  const updateCells=(live:LiveOreCell[])=>{
    const color=geometry.getAttribute('color') as THREE.BufferAttribute;
    for(let c=0;c<live.length;c++){
      const cell=live[c],fraction=cell.valid?Math.max(0,cell.mass/cell.initialMass):0;
      for(let i=ranges[c];i<ranges[c]+30;i++){color.setW(i,initialAlpha[i*4+3]*Math.min(1,fraction*2));patchEmission.setX(i,fraction);}
      for(let j=0;j<3;j++){const i=c*3+j,piece=pieces[i];emission.setX(i,fraction);dummy.position.copy(piece.position);dummy.quaternion.copy(piece.rotation);dummy.scale.copy(piece.scale);dummy.scale.y*=fraction;dummy.scale.multiplyScalar(fraction>0?1:0);dummy.updateMatrix();chunks.setMatrixAt(i,dummy.matrix);}
    }
    color.needsUpdate=true;chunks.instanceMatrix.needsUpdate=true;emission.needsUpdate=true;patchEmission.needsUpdate=true;
  };
  updateCells(cells);chunks.computeBoundingSphere();
  return {patch,chunks,pieces,bed:new THREE.BufferGeometry(),stain:new THREE.BufferGeometry(),updateCells};
}
