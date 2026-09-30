import test from 'node:test';
import assert from 'node:assert/strict';
import {BUILTIN_DOCUMENTS} from './level-document';
import {compileSculpt,baseDistance} from './sculpt';
import {getLevelWorld} from './levels';

test('five level-owned starters are distinct closed meshes within both quality budgets',()=>{
  const sources=Object.values(BUILTIN_DOCUMENTS[1].sculpts!),shapes=new Set<string>();assert.equal(sources.length,5);
  for(const source of sources){const shape=compileSculpt(source);shapes.add(JSON.stringify(shape.contours));
    for(const quality of ['high','standard'] as const){const mesh=shape[quality];assert.ok(mesh.indices.length/3<=(quality==='high'?40000:12000));assert.ok(mesh.normals.every(Number.isFinite));
      // Weld geometric positions for the closure test: chunks intentionally use independent GPU vertices.
      const edges=new Map<string,number>(),vertex=(i:number)=>mesh.positions.slice(i*3,i*3+3).map(v=>v.toFixed(4)).join(',');
      for(let i=0;i<mesh.indices.length;i+=3)for(const [a,b] of [[0,1],[1,2],[2,0]]){const pair=[vertex(mesh.indices[i+a]),vertex(mesh.indices[i+b])].sort().join('/');edges.set(pair,(edges.get(pair)??0)+1);}
      assert.ok([...edges.values()].every(n=>n===2),source.shape+' '+quality+' closed across chunks');
    }
  }assert.equal(shapes.size,5);
});
test('block has broad faces and sliced body retains an open mined recess without texturing',()=>{
  const sources=Object.values(BUILTIN_DOCUMENTS[1].sculpts!),block=sources.find(s=>s.shape==='block')!,cut=sources.find(s=>s.shape==='split')!;
  assert.ok(Math.abs(baseDistance(block,23,0,0)-baseDistance(block,23,8,3))<1.2);
  assert.ok(baseDistance(block,19,12,12)<0);assert.ok(baseDistance(cut,3,5,8)>0);assert.ok(baseDistance(cut,-12,-8,-8)<0);
});
test('belt keeps 18 supported painted deposits, exactly 72 units of each resource',()=>{
  const world=getLevelWorld('belt');assert.equal(world.deposits.length,18);
  for(const r of ['ferrite','copper','crystal'])assert.equal(world.deposits.filter(d=>d.resource===r).reduce((n,d)=>n+d.remaining,0),72);
  for(const d of world.deposits){assert.equal(d.surface?.invalid,false,d.id);assert.ok(d.surface?.cells?.every(c=>Number.isFinite(c.x+c.y+c.z)&&c.valid));}
});
