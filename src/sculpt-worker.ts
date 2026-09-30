import {SculptBuilder,type SculptDefinition,type SculptStroke} from './sculpt';
/** A single editing session owns the mutable field. Epochs invalidate cancelled jobs. */
let builder:SculptBuilder|undefined,epoch=-1;
self.onmessage=(event:MessageEvent<{epoch:number;sequence:number;kind:'reset'|'append'|'finish';source?:SculptDefinition;strokes?:SculptStroke[];scale?:number}>)=>{
  const job=event.data,start=performance.now();
  try{
    if(job.kind==='reset'){epoch=job.epoch;builder=new SculptBuilder(job.source!);}
    if(job.epoch!==epoch||!builder)return;
    const result=job.kind==='finish'?{compiled:builder.finish(job.scale)}:{chunks:job.kind==='reset'?builder.preview():builder.append(job.strokes!)};
    self.postMessage({epoch,sequence:job.sequence,kind:job.kind,...result,computeMs:performance.now()-start});
  }catch(error){self.postMessage({epoch:job.epoch,sequence:job.sequence,error:error instanceof Error?error.message:String(error)});}
};
