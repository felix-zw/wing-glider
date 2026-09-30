import {writeFileSync,statSync,readdirSync} from 'node:fs';
import {BUILTIN_DOCUMENTS} from '../src/level-document';
import {compileSculpt} from '../src/sculpt';

const document=BUILTIN_DOCUMENTS.find(d=>d.id==='belt')!;
const shapes=document.objects.map(object=>{
  const source=document.sculpts![String(object.parameters.sculptId)],start=performance.now(),result=compileSculpt(source,object.scale);
  return {name:source.name,shape:source.shape,highTriangles:result.high.indices.length/3,standardTriangles:result.standard.indices.length/3,contours:result.contours.length,coldCompileMs:performance.now()-start};
});
const bytes=(directory:string):number=>readdirSync(directory,{withFileTypes:true}).reduce((sum,file)=>sum+(file.isDirectory()?bytes(directory+'/'+file.name):statSync(directory+'/'+file.name).size),0);
const report={date:new Date().toISOString(),shapes,stoneTextureBytes:['color','normal','orm'].reduce((sum,map)=>sum+statSync('public/assets/textures/stone-'+map+'.ktx2').size,0),publicAssetBytes:bytes('public/assets')};
writeFileSync('screenshots/sculpt-live/asset-report.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
