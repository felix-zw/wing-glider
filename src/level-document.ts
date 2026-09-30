import {validOreLayer,oreMass,pruneEmptyOreCells,type OreLayer} from './ore-paint';
import builtins from './builtin-levels.json';
import { ASSET_CATALOG } from './asset-catalog';
import { THEMES, type ThemeDefinition } from './themes';
import type { Surface, ResourceId, Position } from './resources';
import {validSculpt,type SculptDefinition} from './sculpt';
import {lightingErrors,validEmission,type LightingDefinition,type Emission} from './lighting';

export interface PlacedObject extends Position { id: string; assetId: string; rotation: number; scale: number; parameters: Record<string, unknown> }
export interface OrePlacement { id: string; structureId?: string; resource: ResourceId; amount: number; x?: number; z?: number; surface?: Surface; paint?:OreLayer;emission?:Emission }
export interface LevelDocument {
  version: 2; id: string; name: string; subtitle: string; description: string; environment: 'planet'|'space'; themeId: string;
  seed: number; bounds: number; spawn: Position; base: Position & {radius:number;maxUnloadSpeed:number;name:string};
  shelters: (Position & {id:string;name:string;radius:number})[]; objects: PlacedObject[]; deposits: OrePlacement[];
  sculpts?:Record<string,SculptDefinition>;
  lighting?:LightingDefinition;
  delivery: Record<ResourceId,number>;
}
export interface LevelPackage { version: 2; level: LevelDocument; themes: ThemeDefinition[] }
export interface LevelIssue { severity:'error'|'warning'; message:string; objectId?:string }
export const BUILTIN_DOCUMENTS = builtins as unknown as LevelDocument[];
export const DOCUMENTS = new Map(BUILTIN_DOCUMENTS.map(d=>[d.id,d]));
export const cloneDocument = (d:LevelDocument):LevelDocument => structuredClone(d);
export function newDocument(environment:'planet'|'space'):LevelDocument {
  const doc=cloneDocument(BUILTIN_DOCUMENTS.find(d=>d.environment===environment)!);
  doc.id='level-'+crypto.randomUUID();doc.name=environment==='space'?'Mein Asteroidengürtel':'Mein Planet';return doc;
}
const finite=(v:unknown)=>typeof v==='number'&&Number.isFinite(v);
const position=(v:any)=>v&&finite(v.x)&&finite(v.z);
const color=(v:unknown)=>typeof v==='string'&&/^#[0-9a-f]{6}$/i.test(v);
const identifier=(v:unknown)=>typeof v==='string'&&/^[a-z0-9][a-z0-9_.-]{0,119}$/i.test(v);
export function validateTheme(t:ThemeDefinition):void {
  if(!t||t.version!==1||!identifier(t.id)||typeof t.name!=='string'||!['planet','space'].includes(t.environment))throw new Error('Ungültiges Theme.');
  for(const key of ['background','fogColor','rockTint','sunColor','ambientColor','groundColor','rimColor'] as const)if(!color(t[key]))throw new Error('Ungültige Theme-Farbe: '+key);
  for(const key of ['fogDensity','decorationDensity','sunIntensity','ambientIntensity','rimIntensity'] as const)if(!finite(t[key])||t[key]<0||t[key]>(key==='fogDensity'?.01:key==='decorationDensity'?2:10))throw new Error('Ungültiger Theme-Wert: '+key);
  if(!finite(t.sunAzimuth)||!finite(t.sunElevation)||t.sunElevation<10||t.sunElevation>85)throw new Error('Ungültige Lichtrichtung.');
}
/** Reject malformed imports before touching storage or the live registries. */
export function parsePackage(text:string):LevelPackage {
  if(text.length>32_000_000)throw new Error('Die Leveldatei ist zu groß.');
  const pack=JSON.parse(text) as LevelPackage;
  if(pack?.level?.environment==='space'&&(pack.version!==2||pack.level.version!==2))throw new Error('Dieses Asteroiden-Level verwendet das alte Modellformat. Bitte einen neuen Gürtel erstellen.');
  if((pack as any)?.version===1&&pack.level?.environment==='planet'){pack.version=2;pack.level.version=2;}
  if(!pack||pack.version!==2||!Array.isArray(pack.themes)||pack.themes.length>16)throw new Error('Nicht unterstütztes Levelpaket.');
  pack.themes.forEach(validateTheme);
  if(Array.isArray(pack.level?.deposits))pack.level.deposits.forEach(ore=>pruneEmptyOreCells(ore?.paint));
  const themes={...THEMES,...Object.fromEntries(pack.themes.map(t=>[t.id,t]))};
  const errors=validateDocument(pack.level,themes).filter(i=>i.severity==='error');
  if(errors.length)throw new Error(errors[0].message);
  return pack;
}
export function validateDocument(d:LevelDocument,themes:Record<string,ThemeDefinition>=THEMES):LevelIssue[] {
  const issues:LevelIssue[]=[];const error=(message:string,objectId?:string)=>issues.push({severity:'error',message,objectId});
  if(!d||d.version!==2||!identifier(d.id)||typeof d.name!=='string'||d.name.length>100||typeof d.subtitle!=='string'||typeof d.description!=='string'){error('Ungültiges Leveldokument.');return issues;}
  if(!['planet','space'].includes(d.environment)||!themes[d.themeId]||themes[d.themeId].environment!==d.environment)error('Theme und Umgebung passen nicht zusammen.');
  if(!finite(d.seed)||!finite(d.bounds)||d.bounds<100||d.bounds>400)error('Ungültiger Seed oder Levelradius (100–400 m).');
  if(!position(d.spawn)||!position(d.base)||typeof d.base?.name!=='string'||!finite(d.base?.radius)||d.base.radius<5||d.base.radius>30||!finite(d.base.maxUnloadSpeed)||d.base.maxUnloadSpeed<0)error('Startpunkt oder ATLAS ist ungültig.');
  if(!Array.isArray(d.objects)||d.objects.length>80||!Array.isArray(d.deposits)||d.deposits.length>128||!Array.isArray(d.shelters)||d.shelters.length>32){error('Ungültige Objektliste oder zu viele Objekte.');return issues;}
  if(d.sculpts&&(typeof d.sculpts!=='object'||Array.isArray(d.sculpts)||Object.keys(d.sculpts).length>80||Object.entries(d.sculpts).some(([id,sculpt])=>id!==sculpt?.id||!validSculpt(sculpt))))error('Ungültige modellierte Asteroiden.');
  const ids=new Set<string>(['spawn','base']);
  if(d.objects.some(o=>!o||typeof o!=='object')||d.deposits.some(o=>!o||typeof o!=='object')||d.shelters.some(o=>!o||typeof o!=='object')){error('Ungültiger Eintrag in einer Objektliste.');return issues;}
  for(const o of d.objects){
    const a=ASSET_CATALOG[o.assetId];
    if(!identifier(o.id)||ids.has(o.id))error('Objekt-IDs müssen eindeutig sein.',o.id);ids.add(o.id);
    if(!a||a.environment!==d.environment){error('Unbekanntes oder unpassendes Asset.',o.id);continue;}
    if(o.assetId==='sculpt-asteroid'&&(!d.sculpts?.[String(o.parameters?.sculptId)]||!validSculpt(d.sculpts[String(o.parameters?.sculptId)])))error('Asteroid ohne eigene Form.',o.id);
    if(!position(o)||!finite(o.rotation)||!finite(o.scale)||o.scale<a.scaleRange[0]||o.scale>a.scaleRange[1]||!o.parameters)error('Ungültige Objekttransformation.',o.id);
    if(a.kind!=='asteroid')for(const key of a.kind==='hill'?['radius','height']:['halfX','halfZ','height'])if(!finite(o.parameters?.[key])||Number(o.parameters[key])<=0||Number(o.parameters[key])>120)error('Ungültige Landschaftsparameter.',o.id);
  }
  const depositIds=new Set<string>();
  for(const dpt of d.deposits){
    if(!identifier(dpt.id)||depositIds.has(dpt.id)||ids.has(dpt.id))error('Erz-IDs müssen eindeutig sein.',dpt.id);depositIds.add(dpt.id);
    if(!['ferrite','copper','crystal'].includes(dpt.resource)||!finite(dpt.amount)||dpt.amount<=0||dpt.amount>50000)error('Ungültige Erzmenge oder Rohstoffart.',dpt.id);
    const host=d.objects.find(o=>o.id===dpt.structureId);
    if(!host){error('Erzstelle ohne Felsformation.',dpt.id);continue;}
    if(d.environment==='space'){
      if(!dpt.paint||!validOreLayer(dpt.paint))error('Ungültige gemalte Erzschicht.',dpt.id);
      else if(Math.abs(dpt.amount-oreMass(dpt.paint,host.scale))>.001)error('Erzmenge und bemalte Schicht stimmen nicht überein.',dpt.id);
    }
    else if(!position(dpt)||!dpt.surface||!['ground','wall'].includes(dpt.surface.kind)||!['y','nx','nz','width'].every(k=>finite((dpt.surface as any)[k]))||dpt.surface.width<=0||dpt.surface.width>100||Math.hypot(dpt.surface.nx,dpt.surface.nz)<.1)error('Ungültige Erzoberfläche.',dpt.id);
  }
  for(const s of d.shelters){if(!identifier(s.id)||ids.has(s.id)||depositIds.has(s.id)||!position(s)||!finite(s.radius)||s.radius<5||s.radius>30||typeof s.name!=='string')error('Ungültiger Schutzbereich.',s.id);ids.add(s.id);}
  if(!d.delivery||!['ferrite','copper','crystal'].every(r=>Number.isInteger(d.delivery[r as ResourceId])&&d.delivery[r as ResourceId]>=0&&d.delivery[r as ResourceId]<=10000))error('Ungültige Lieferziele.');
  if(d.lighting)for(const message of lightingErrors(d.lighting))error(message);
  for(const ore of d.deposits)if(ore.emission&&!validEmission(ore.emission))error('Ungültiges Erzleuchten.',ore.id);
  if(d.lighting&&Array.isArray(d.lighting.bodies)&&Array.isArray(d.lighting.lamps))for(const entry of [...d.lighting.bodies,...d.lighting.lamps])if(entry&&(ids.has(entry.id)||depositIds.has(entry.id)))error('Licht- und Objekt-IDs müssen eindeutig sein.',entry.id);
  return issues;
}
export const packageLevel=(level:LevelDocument):LevelPackage=>({version:2,level:cloneDocument(level),themes:[structuredClone(THEMES[level.themeId])]});
