import test from 'node:test';
import assert from 'node:assert/strict';
import {BUILTIN_DOCUMENTS,cloneDocument} from './level-document';
import {compileLevel,installLevel} from './levels';
import {EditorHistory} from './editor-model';
import {THEMES} from './themes';
import {compileSculpt,newSculpt} from './sculpt';
import {packSculpt,unpackSculpt} from './sculpt-transfer';
test('transferred sculpt buffers preserve exact queries, paint and both quality levels',()=>{
  const source=newSculpt('wire-form','block');source.seed=17;const compiled=compileSculpt(source),transfers:Transferable[]=[];
  const packed=packSculpt(compiled,transfers),received=structuredClone(packed,{transfer:transfers});assert.equal(packed.high.positions.byteLength,0);assert.deepEqual(unpackSculpt(received),compiled);
});
test('adopting a cooked world restores local queries and preserves immutable revisions',()=>{
  const document=cloneDocument(BUILTIN_DOCUMENTS[1]);document.id='worker-adoption';const cooked=structuredClone(compileLevel(document));for(const solid of cooked.solids)if(solid.kind==='asteroid')delete solid.query;
  const installed=installLevel(document,cooked);assert.ok(installed.solids.every(s=>s.kind!=='asteroid'||s.query));assert.ok(Object.isFrozen(installed.deposits));assert.ok(Object.isFrozen(installed.solids[0]));
  const lighting=structuredClone(installed.lighting);lighting.bodies[0].intensity=1.71;
  const updated=installLevel(document,{...installed,lighting});assert.equal(updated.solids,installed.solids);assert.equal(updated.lighting.bodies[0].intensity,1.71);assert.equal(installed.lighting.bodies[0].intensity,cooked.lighting.bodies[0].intensity);
});
test('history keeps queued save snapshots stable while subsequent edits continue',()=>{
  const history=new EditorHistory({level:cloneDocument(BUILTIN_DOCUMENTS[1]),theme:structuredClone(THEMES.belt),selection:null});const queued=history.current;
  history.change(s=>{s.level.objects[0].x+=20;s.level.name='Later';});assert.notEqual(history.current,queued);assert.equal(queued.level.name,BUILTIN_DOCUMENTS[1].name);assert.equal(queued.level.objects[0].x,BUILTIN_DOCUMENTS[1].objects[0].x);assert.ok(history.undo());assert.deepEqual(history.current,queued);
});
