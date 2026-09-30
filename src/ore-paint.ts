import {rayRock,transformRockPoint,transformRockNormal,type RockPlacement} from './rock-surface';
import type {Vec3} from './rock-surface';

export type Triple=[number,number,number];
/** Surface samples are level-owned, in host-local metres. Area never depends on UVs. */
export interface OreCell {position:Triple;normal:Triple;radius:number;thickness:number}
export interface OreLayer {version:1;cells:OreCell[]}
export interface LiveOreCell extends Vec3 {normal:Vec3;radius:number;mass:number;initialMass:number;valid:boolean}
export const ORE_DENSITY=.75;
/** Repair empty brush-edge samples written by the former spray implementation.
 * Real ore, its mass, and all other validation errors are left untouched. */
export function pruneEmptyOreCells(layer?:OreLayer){
  if(layer?.version===1&&Array.isArray(layer.cells))layer.cells=layer.cells.filter(c=>c?.thickness!==0);
}
export const oreMass=(layer:OreLayer,scale=1)=>layer.cells.reduce((sum,c)=>sum+Math.PI*c.radius*c.radius*c.thickness*ORE_DENSITY*scale**3,0);
export function validOreLayer(layer:OreLayer){
  return !!layer&&layer.version===1&&Array.isArray(layer.cells)&&layer.cells.length>0&&layer.cells.length<=8192&&layer.cells.every(c=>
    c&&Array.isArray(c.position)&&c.position.length===3&&c.position.every(v=>Number.isFinite(v)&&Math.abs(v)<=36)&&
    Array.isArray(c.normal)&&c.normal.length===3&&c.normal.every(Number.isFinite)&&Math.abs(Math.hypot(...c.normal)-1)<.02&&
    Number.isFinite(c.radius)&&c.radius>=.3&&c.radius<=3&&Number.isFinite(c.thickness)&&c.thickness>0&&c.thickness<=4);
}
/** Only a nearby surface with the original orientation may support this sample. */
export function resolveOreCell(host:RockPlacement,cell:OreCell):LiveOreCell {
  const scale=host.scale??1,anchor=transformRockPoint(host,cell.position),normal=transformRockNormal(host,cell.normal),reach=1.8*scale;
  const origin={x:anchor.x+normal.x*reach,y:anchor.y+normal.y*reach,z:anchor.z+normal.z*reach};
  const hit=rayRock(host,origin,{x:-normal.x,y:-normal.y,z:-normal.z},reach*2);
  const valid=!!hit&&hit.normal.x*normal.x+hit.normal.y*normal.y+hit.normal.z*normal.z>.4;
  const point=valid?hit!:anchor,n=valid?hit!.normal:normal;
  const mass=Math.PI*cell.radius**2*cell.thickness*ORE_DENSITY*scale**3;
  return {x:point.x+n.x*.06,y:point.y+n.y*.06,z:point.z+n.z*.06,normal:n,radius:cell.radius*scale,mass,initialMass:mass,valid};
}
/** Repeated stamps increase thickness, never manufacture another coplanar layer. */
export function sprayOre(layer:OreLayer,samples:{position:Triple;normal:Triple;weight:number}[],seconds:number,strength:number,maximum:number,radius=.85){
  for(const sample of samples){
    const added=seconds*strength*sample.weight*1.8;
    // Zero falloff at the brush edge must not create an invalid empty cell.
    if(!Number.isFinite(added)||added<=0||maximum<=0)continue;
    let cell=layer.cells.find(c=>Math.hypot(...c.position.map((v,i)=>v-sample.position[i]))<radius*1.15&&c.normal.reduce((n,v,i)=>n+v*sample.normal[i],0)>.7);
    if(!cell){if(layer.cells.length>=8192)continue;cell={position:[...sample.position],normal:[...sample.normal],radius,thickness:0};layer.cells.push(cell);}
    cell.thickness=Math.max(cell.thickness,Math.min(maximum,cell.thickness+added));
  }
}
