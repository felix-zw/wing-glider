/** One atomic write at a time, with only the newest waiting snapshot retained. */
export class SnapshotWriter<T> {
  private pending=new Map<string,{revision:number;value:T}>();private running=false;
  private saved=new Map<string,number>();
  private waiters:{key:string;revision:number;resolve:()=>void;reject:(error:unknown)=>void}[]=[];
  savedRevision=-1;
  constructor(private write:(value:T,revision:number)=>Promise<void>,private keyOf:(value:T)=>string=()=> ''){}
  save(value:T,revision:number):Promise<void>{
    const key=this.keyOf(value);if(revision<=(this.saved.get(key)??-1))return Promise.resolve();
    const pending=this.pending.get(key);if(!pending||revision>=pending.revision)this.pending.set(key,{revision,value});
    const promise=new Promise<void>((resolve,reject)=>this.waiters.push({key,revision,resolve,reject}));void this.pump();return promise;
  }
  private async pump(){
    if(this.running)return;this.running=true;
    while(this.pending.size){const [key,job]=this.pending.entries().next().value!;this.pending.delete(key);
      try{await this.write(job.value,job.revision);this.saved.set(key,job.revision);this.savedRevision=Math.max(this.savedRevision,job.revision);const done=this.waiters.filter(w=>w.key===key&&w.revision<=job.revision);this.waiters=this.waiters.filter(w=>!done.includes(w));done.forEach(w=>w.resolve());}
      catch(error){const failed=this.waiters.filter(w=>w.key===key&&w.revision<=job.revision);this.waiters=this.waiters.filter(w=>!failed.includes(w));failed.forEach(w=>w.reject(error));}
    }this.running=false;
  }
}
