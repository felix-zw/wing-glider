import fs from 'node:fs';
import {newSculpt,compileSculpt,SCULPT_SHAPES} from '../src/sculpt';
import {ASTEROIDS} from '../src/asset-catalog';
import {rayRock} from '../src/rock-surface';
import {oreMass,type OreLayer} from '../src/ore-paint';

// Authoring utility: writes the complete, editable forms and painted ore into the level.
const path='src/builtin-levels.json',documents=JSON.parse(fs.readFileSync(path,'utf8'));
for(const d of documents)d.version=2;
const belt=documents.find((d:any)=>d.id==='belt');belt.sculpts={};belt.deposits=[];
const shapes=['slab','split','long','block','mass'] as const;
let ordinal=0;
for(let i=0;i<5;i++){
  const object=belt.objects[i],source=newSculpt('belt-form-'+i,shapes[i]);source.seed=7113+i*7919;source.name=SCULPT_SHAPES[shapes[i]];
  belt.sculpts[source.id]=source;object.assetId='sculpt-asteroid';object.parameters={sculptId:source.id};
  const compiled=compileSculpt(source,object.scale);
  ASTEROIDS[source.id]={id:source.id,name:source.name,vertices:compiled.vertices,indices:compiled.indices,footprint:compiled.contours[0],footprints:compiled.contours};
  const host={kind:'asteroid' as const,id:object.id,assetId:source.id,x:0,z:0,scale:1,rotation:0,radius:36,height:72};
  const count=i===4?2:4;
  for(let j=0;j<count;j++){
    const angle=i===1?[3.2,3.9,4.6,5.3][j]:i===4?[3.2,5.6][j]:(j+.27)/count*Math.PI*2+.3*i,nx=Math.cos(angle),nz=Math.sin(angle),paint:OreLayer={version:1,cells:[]};
    for(const y of [-1.2,.3,1.8])for(const u of [-3,-1.5,0,1.5,3]){
      const jitterU=u+Math.sin(u*7.31+y*4.7+ordinal*1.91)*.52,jitterY=y+Math.cos(u*6.2+y*5.81+ordinal*2.4)*.48;
      const hit=rayRock(host,{x:nx*40-nz*jitterU,y:jitterY+2.4,z:nz*40+nx*jitterU},{x:-nx,y:0,z:-nz},80);
      if(hit)paint.cells.push({position:[hit.x,hit.y-2.4,hit.z],normal:[hit.normal.x,hit.normal.y,hit.normal.z],radius:.85,thickness:1});
    }
    if(!paint.cells.length)throw new Error('Missing painted surface');
    const thickness=12/oreMass(paint,object.scale);paint.cells.forEach(c=>c.thickness=thickness);
    belt.deposits.push({id:'belt-vein-'+ordinal,structureId:object.id,resource:['ferrite','copper','crystal'][ordinal%3],amount:12,paint});ordinal++;
  }
}
fs.writeFileSync(path,JSON.stringify(documents,null,2)+'\n');
console.log('Five local forms, 18 painted layers, 72 units per resource.');
