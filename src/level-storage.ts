import {parsePackage, type LevelPackage} from './level-document';
import type {SculptDefinition} from './sculpt';
import type {OrePlacement} from './level-document';
import {pruneEmptyOreCells} from './ore-paint';

export interface SculptTemplate {version:2;id:string;name:string;sculpt:SculptDefinition;ores:Omit<OrePlacement,'id'|'structureId'>[]}

const database=():Promise<IDBDatabase>=>new Promise((resolve,reject)=>{
  const request=indexedDB.open('wing-glider-workshop',3);
  request.onupgradeneeded=event=>upgradeWorkshop(request.result,request.transaction!,event.oldVersion);
  request.onblocked=()=>reject(new Error('Bitte andere Wing-Glider-Tabs schließen, damit der lokale Speicher aktualisiert werden kann.'));
  request.onsuccess=()=>{request.result.onversionchange=()=>request.result.close();resolve(request.result);};request.onerror=()=>reject(request.error);
});
export async function saveLevel(pack:LevelPackage):Promise<void>{
  const db=await database();
    try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction('levels','readwrite');tx.objectStore('levels').put(pack);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}
  finally{db.close();}
}
export async function savedLevels():Promise<LevelPackage[]>{
  const db=await database();
  try{return await new Promise((resolve,reject)=>{const request=db.transaction('levels').objectStore('levels').getAll();request.onsuccess=()=>{
    const packs=request.result as LevelPackage[];for(const pack of packs)pack.level.deposits.forEach(ore=>pruneEmptyOreCells(ore.paint));resolve(packs);
  };request.onerror=()=>reject(request.error);});}
  finally{db.close();}
}
export const exportLevel=(pack:LevelPackage)=>JSON.stringify(pack,null,2);
export const importLevel=(text:string)=>parsePackage(text);
export async function saveTemplate(template:SculptTemplate):Promise<void>{
  const db=await database();try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction('templates','readwrite');tx.objectStore('templates').put(structuredClone(template));tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}finally{db.close();}
}
export async function savedTemplates():Promise<SculptTemplate[]>{
  const db=await database();try{return await new Promise((resolve,reject)=>{const request=db.transaction('templates').objectStore('templates').getAll();request.onsuccess=()=>{
    const templates=request.result as SculptTemplate[];for(const template of templates)template.ores.forEach(ore=>pruneEmptyOreCells(ore.paint));resolve(templates);
  };request.onerror=()=>reject(request.error);});}finally{db.close();}
}
export async function deleteTemplate(id:string):Promise<void>{
  const db=await database();try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction('templates','readwrite');tx.objectStore('templates').delete(id);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}finally{db.close();}
}

/** Schema 3 intentionally discards retired space formats, preserving all planet drafts. */
export function upgradeWorkshop(db:IDBDatabase,tx:IDBTransaction,oldVersion:number){
  if(oldVersion>0){const cursor=tx.objectStore('levels').openCursor();cursor.onsuccess=()=>{const c=cursor.result;if(!c)return;const pack=c.value;
    if(pack.level?.environment==='space')c.delete();else{pack.version=2;pack.level.version=2;c.update(pack);}c.continue();};
    if(db.objectStoreNames.contains('templates'))tx.objectStore('templates').clear();
  }
  if(!db.objectStoreNames.contains('levels'))db.createObjectStore('levels',{keyPath:'level.id'});
  if(!db.objectStoreNames.contains('templates'))db.createObjectStore('templates',{keyPath:'id'});
}
