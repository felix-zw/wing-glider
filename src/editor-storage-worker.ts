import {saveLevel} from './level-storage';
import type {LevelPackage} from './level-document';
self.onmessage=async(event:MessageEvent<{revision:number;pack:LevelPackage}>)=>{
  const {revision,pack}=event.data;
  try{await saveLevel(pack);self.postMessage({revision});}
  catch(error){self.postMessage({revision,error:error instanceof Error?error.message:String(error)});}
};
