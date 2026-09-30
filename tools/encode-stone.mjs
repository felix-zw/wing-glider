import {spawnSync} from 'node:child_process';
for(const channel of ['color','normal','orm']){
 const r=spawnSync(process.execPath,['tools/encode-texture.mjs','-file','/work/art/surfaces/stone-'+channel+'.png','-output_file','/work/public/assets/textures/stone-'+channel+'.ktx2','-uastc','-uastc_level','1','-mipmap','-ktx2','-no_multithreading',...(channel==='color'?[]:['-linear'])],{stdio:'inherit'});
 if(r.status)process.exit(r.status);
}
