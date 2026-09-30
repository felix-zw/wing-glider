import type {SculptCompiled,SculptMesh} from './sculpt';
type PackedMesh={positions:Float64Array;normals:Float64Array;indices:Uint32Array;paint:Float64Array;glow?:Float64Array};
export interface PackedSculpt {high:PackedMesh;standard:PackedMesh;contours:SculptCompiled['contours']}
export function packSculpt(compiled:SculptCompiled,transfers:Transferable[]):PackedSculpt {
  const pack=(mesh:SculptMesh):PackedMesh=>{const result={positions:new Float64Array(mesh.positions),normals:new Float64Array(mesh.normals),indices:new Uint32Array(mesh.indices),paint:new Float64Array(mesh.paint),glow:mesh.glow?new Float64Array(mesh.glow):undefined};for(const a of Object.values(result))if(a)transfers.push(a.buffer);return result;};
  return {high:pack(compiled.high),standard:pack(compiled.standard),contours:compiled.contours};
}
export function unpackSculpt(compiled:PackedSculpt):SculptCompiled {
  const unpack=(mesh:PackedMesh):SculptMesh=>({positions:Array.from(mesh.positions),normals:Array.from(mesh.normals),indices:Array.from(mesh.indices),paint:Array.from(mesh.paint),glow:mesh.glow?Array.from(mesh.glow):undefined});
  const high=unpack(compiled.high),vertices:number[][]=[];for(let i=0;i<high.positions.length;i+=3)vertices.push(high.positions.slice(i,i+3));
  return {high,standard:unpack(compiled.standard),vertices,indices:high.indices,contours:compiled.contours};
}
