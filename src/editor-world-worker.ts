import {compileLevel,type LevelWorld} from './levels';
import {inspectLevel} from './editor-model';
import {THEMES,type ThemeDefinition} from './themes';
import type {LevelDocument,LevelIssue} from './level-document';
import {getSculpt,sculptKey,retainSculpts} from './sculpt-runtime';
import {packSculpt,type PackedSculpt} from './sculpt-transfer';
export interface EditorWorldRequest {revision:number;document:LevelDocument;theme:ThemeDefinition;known:Record<string,string|undefined>}
export interface EditorWorldResult {revision:number;world?:LevelWorld;issues:LevelIssue[];sculpts:{objectId:string;key:string;compiled:PackedSculpt}[];anchors?:{id:string;cells:{index:number;position:[number,number,number];normal:[number,number,number]}[]}[];computeMs:number;error?:string}
self.onmessage=(event:MessageEvent<EditorWorldRequest>)=>{
  const job=event.data,start=performance.now(),transfers:Transferable[]=[],sculpts:EditorWorldResult['sculpts']=[];
  try{
    THEMES[job.theme.id]=job.theme;const world=compileLevel(job.document);
    // One compilation feeds validation, rendering, ore queries and collision.
    const issues=inspectLevel(job.document,world);retainSculpts(job.document.id,job.document.objects.map(o=>o.id));
    const anchors:NonNullable<EditorWorldResult['anchors']>=[];
    for(const ore of job.document.deposits){if(!ore.paint)continue;const object=job.document.objects.find(o=>o.id===ore.structureId)!,live=world.deposits.find(d=>d.id===ore.id)!,c=Math.cos(object.rotation),n=Math.sin(object.rotation),k=object.scale,cells:NonNullable<EditorWorldResult['anchors']>[number]['cells']=[];
      live.surface!.cells!.forEach((p,index)=>{if(!p.valid)return;const dx=(p.x-p.normal.x*.06-object.x)/k,dz=(p.z-p.normal.z*.06-object.z)/k,position:[number,number,number]=[dx*c+dz*n,(p.y-p.normal.y*.06-2.4)/k,-dx*n+dz*c],normal:[number,number,number]=[p.normal.x*c+p.normal.z*n,p.normal.y,-p.normal.x*n+p.normal.z*c],old=ore.paint!.cells[index];if(position.some((v,i)=>Math.abs(v-old.position[i])>1e-5)||normal.some((v,i)=>Math.abs(v-old.normal[i])>1e-5))cells.push({index,position,normal});});if(cells.length)anchors.push({id:ore.id,cells});
    }
    for(const object of job.document.objects)if(object.assetId==='sculpt-asteroid'){
      const source=job.document.sculpts![String(object.parameters.sculptId)],key=sculptKey(source,object.scale);
      if(job.known[object.id]!==key)sculpts.push({objectId:object.id,key,compiled:packSculpt(getSculpt(job.document.id,object.id)!,transfers)});
    }
    // Query meshes already arrive once in the transferred sculpt buffers.
    const detached=structuredClone(world);for(const solid of detached.solids)if(solid.kind==='asteroid')delete solid.query;
    self.postMessage({revision:job.revision,world:detached,issues,sculpts,anchors,computeMs:performance.now()-start},{transfer:transfers});
  }catch(error){self.postMessage({revision:job.revision,issues:[],sculpts:[],computeMs:performance.now()-start,error:error instanceof Error?error.message:String(error)});}
};
