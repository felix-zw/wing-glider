import {compileSculpt} from './sculpt';
import {generateForm,generateOres,generateSurfaceGlow,generateCore,type GenerationRequest,type GenerationResult} from './asteroid-generator';
self.onmessage=(e:MessageEvent<GenerationRequest>)=>{
  const job=e.data;try{
    let source=structuredClone(job.source);
    const form=job.action==='form'||job.action==='all',glow=job.action==='glow'||job.action==='all';
    if(form)source=generateForm(source,job.seed,job.options);
    let compiled=form||!job.compiled?compileSculpt(source,job.scale):job.compiled;
    const ores=job.action==='ore'||job.action==='all'?generateOres(compiled,job.scale,job.seed,job.options):undefined;
    if(glow)source=generateSurfaceGlow(source,compiled,job.seed,job.options);
    if(job.action==='core'||job.action==='all')source=generateCore(source,compiled,job.seed,job.options);
    if(glow)compiled=compileSculpt(source,job.scale);
    const result:GenerationResult={epoch:job.epoch,source,ores,compiled:form||glow?compiled:undefined};self.postMessage(result);
  }catch(error){self.postMessage({epoch:job.epoch,error:error instanceof Error?error.message:String(error)});}
};
