import test from 'node:test';
import assert from 'node:assert/strict';
import {SnapshotWriter} from './snapshot-writer';
test('snapshot writes coalesce waiting revisions and never acknowledge newer unsaved edits',async()=>{
  const writes:number[]=[],releases:(()=>void)[]=[];
  const writer=new SnapshotWriter<number>(value=>{writes.push(value);return new Promise<void>(resolve=>releases.push(resolve));});
  const first=writer.save(1,1),second=writer.save(2,2),third=writer.save(3,3);let latestSaved=false;third.then(()=>latestSaved=true);
  assert.deepEqual(writes,[1]);releases.shift()!();await first;await Promise.resolve();assert.equal(latestSaved,false);assert.equal(writer.savedRevision,1);assert.deepEqual(writes,[1,3]);
  releases.shift()!();await Promise.all([second,third]);assert.equal(latestSaved,true);assert.equal(writer.savedRevision,3);await writer.save(1,1);assert.deepEqual(writes,[1,3]);
});
test('a failed atomic write remains dirty and can be retried without blocking newer writes',async()=>{
  let fail=true;const writer=new SnapshotWriter<number>(async()=>{if(fail)throw Error('quota');});
  await assert.rejects(writer.save(1,1),/quota/);assert.equal(writer.savedRevision,-1);fail=false;await writer.save(2,2);assert.equal(writer.savedRevision,2);
});
test('switching documents keeps each final snapshot and only acknowledges its own write',async()=>{
  const writes:string[]=[],releases:(()=>void)[]=[];
  const writer=new SnapshotWriter<{id:string;name:string}>(value=>{writes.push(value.name);return new Promise<void>(resolve=>releases.push(resolve));},value=>value.id);
  const first=writer.save({id:'a',name:'a1'},1),a2=writer.save({id:'a',name:'a2'},2),b=writer.save({id:'b',name:'b3'},3),a4=writer.save({id:'a',name:'a4'},4);let bSaved=false;b.then(()=>bSaved=true);
  releases.shift()!();await first;assert.deepEqual(writes,['a1','a4']);
  releases.shift()!();await Promise.all([a2,a4]);assert.equal(bSaved,false);assert.deepEqual(writes,['a1','a4','b3']);
  releases.shift()!();await b;assert.equal(bSaved,true);
});
