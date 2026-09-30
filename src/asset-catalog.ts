/** Runtime surface queries. No shipped model or template is a level dependency. */
export interface AsteroidAsset {id:string;name:string;vertices:number[][];indices:number[];footprint:{x:number;z:number}[];footprints:{x:number;z:number}[][]}
export const ASTEROIDS:Record<string,AsteroidAsset>={};
export interface AssetDefinition {version:2;id:string;name:string;environment:'planet'|'space';kind:'hill'|'cliff'|'asteroid';scaleRange:readonly number[]}
export const ASSET_CATALOG:Record<string,AssetDefinition>={
  hill:{version:2,id:'hill',name:'Sandhügel',environment:'planet',kind:'hill',scaleRange:[.4,2]},
  cliff:{version:2,id:'cliff',name:'Felsrücken',environment:'planet',kind:'cliff',scaleRange:[.4,2]},
  'sculpt-asteroid':{version:2,id:'sculpt-asteroid',name:'Asteroid',environment:'space',kind:'asteroid',scaleRange:[.6,1.5]},
};
