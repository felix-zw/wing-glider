import type {ThemeDefinition} from './themes';

export interface Emission {color:string;intensity:number}
export interface RockGlow extends Emission {version:1;cracks:number;core:{enabled:boolean;center:[number,number,number];radii:[number,number,number];softness:number;color:string;intensity:number}}
export interface SolarCorona {extent:number;strength:number;motion:number}
export interface PlanetAtmosphere {extent:number;strength:number;color:string}
export interface PlanetRingDefinition {enabled:boolean;inner:number;outer:number;orientation:[number,number,number,number];color:string;opacity:number;density:number}
export interface SkyBody {id:string;name:string;kind:'sun'|'planet';visible:boolean;illuminates:boolean;azimuth:number;elevation:number;size:number;distance?:number;color:string;intensity:number;surface:'rocky'|'ocean'|'gas';atmosphere:boolean;air?:PlanetAtmosphere;corona?:SolarCorona;ring?:PlanetRingDefinition}
export const newCorona=():SolarCorona=>({extent:.55,strength:1.4,motion:.45});
export const newAtmosphere=():PlanetAtmosphere=>({extent:.08,strength:1.2,color:'#66baff'});
export const newPlanetRing=():PlanetRingDefinition=>({enabled:false,inner:1.3,outer:2.8,orientation:[0,0,0,1],color:'#c8b797',opacity:.78,density:.6});
export const skyBodyRadius=(body:Pick<SkyBody,'size'>)=>Math.tan(body.size*Math.PI/360)*1000;
export const minimumSkyDistance=(body:Pick<SkyBody,'size'>)=>Math.max(25,skyBodyRadius(body)*1.03+5);
export type LampKind='buoy'|'beacon'|'floodlight'|'reactor';
export interface LocalLamp extends Emission {id:string;kind:LampKind;x:number;z:number;height:number;range:number;azimuth:number;elevation:number;angle:number;pattern:'steady'|'pulse'|'flicker'}
export interface LightingDefinition {version:1;bodies:SkyBody[];lamps:LocalLamp[];primary:string|null}
export const LAMP_NAMES:Record<LampKind,string>={buoy:'Leuchtboje',beacon:'Warnbake',floodlight:'Bergbauscheinwerfer',reactor:'Reaktorkern'};
export const newRockGlow=():RockGlow=>({version:1,color:'#ff7c36',intensity:3,cracks:.7,core:{enabled:false,center:[0,0,0],radii:[15,14,15],softness:.2,color:'#ff5424',intensity:4}});
export const direction=(azimuth:number,elevation:number)=>{const a=azimuth*Math.PI/180,e=elevation*Math.PI/180;return {x:Math.cos(a)*Math.cos(e),y:Math.sin(e),z:Math.sin(a)*Math.cos(e)};};
export function themeLighting(t:ThemeDefinition):LightingDefinition {
  return {version:1,primary:'sky-main',bodies:[
    {id:'sky-main',name:'Hauptlicht',kind:'sun',visible:false,illuminates:true,azimuth:t.sunAzimuth,elevation:t.sunElevation,size:12,color:t.sunColor,intensity:t.sunIntensity,surface:'rocky',atmosphere:true},
    {id:'sky-rim',name:'Streiflicht',kind:'sun',visible:false,illuminates:true,azimuth:Math.atan2(100,80)*180/Math.PI,elevation:Math.atan2(40,Math.hypot(80,100))*180/Math.PI,size:12,color:t.rimColor,intensity:t.rimIntensity,surface:'rocky',atmosphere:true}
  ],lamps:[]};
}
export function newSkyBody(id:string,kind:SkyBody['kind']):SkyBody{return {id,name:kind==='sun'?'Sonne':'Planet',kind,visible:true,illuminates:true,azimuth:kind==='sun'?-130:40,elevation:35,size:kind==='sun'?10:24,distance:1000,color:kind==='sun'?'#ffddb0':'#7dafff',intensity:kind==='sun'?2:.7,surface:'ocean',atmosphere:true};}
export function newLamp(id:string,kind:LampKind,x=0,z=0):LocalLamp{return {id,kind,x,z,height:kind==='floodlight'?9:4,color:kind==='reactor'?'#72f5d5':kind==='beacon'?'#ff7438':'#a2e3ff',intensity:kind==='floodlight'?450:120,range:kind==='floodlight'?65:28,azimuth:0,elevation:-25,angle:35,pattern:kind==='beacon'?'pulse':kind==='reactor'?'flicker':'steady'};}
const num=(v:unknown,a:number,b:number)=>typeof v==='number'&&Number.isFinite(v)&&v>=a&&v<=b;
const color=(v:unknown)=>typeof v==='string'&&/^#[a-f\d]{6}$/i.test(v);
const id=(v:unknown)=>typeof v==='string'&&/^[a-z0-9][a-z0-9_.-]{0,119}$/i.test(v);
export const validEmission=(e:Emission)=>!!e&&color(e.color)&&num(e.intensity,0,20);
export function validRockGlow(g:RockGlow){return !!g&&g.version===1&&validEmission(g)&&num(g.cracks,0,1)&&!!g.core&&typeof g.core.enabled==='boolean'&&validEmission(g.core)&&Array.isArray(g.core.center)&&g.core.center.length===3&&g.core.center.every(v=>num(v,-36,36))&&Array.isArray(g.core.radii)&&g.core.radii.length===3&&g.core.radii.every(v=>num(v,1,36))&&num(g.core.softness,.01,1);}
export function lightingErrors(l:LightingDefinition):string[]{
  if(!l||l.version!==1||!Array.isArray(l.bodies)||!Array.isArray(l.lamps)||l.bodies.length>16||l.lamps.length>96)return ['Ungültige Lichtdaten (max. 16 Himmelskörper / 96 Lampen).'];
  const errors:string[]=[],ids=new Set<string>();
  for(const b of l.bodies){if(!b||!id(b.id)||ids.has(b.id)||typeof b.name!=='string'||b.name.length>100||!['sun','planet'].includes(b.kind)||typeof b.visible!=='boolean'||typeof b.illuminates!=='boolean'||!num(b.azimuth,-180,180)||!num(b.elevation,-90,90)||!num(b.size,1,70)||(b.distance!==undefined&&!num(b.distance,minimumSkyDistance(b),20000))||!color(b.color)||!num(b.intensity,0,10)||!['rocky','ocean','gas'].includes(b.surface)||typeof b.atmosphere!=='boolean')errors.push('Ungültiger Himmelskörper oder Abstand innerhalb des Körpers.');if(b)ids.add(b.id);
    if(b?.corona&&(b.kind!=='sun'||!num(b.corona.extent,.1,2)||!num(b.corona.strength,0,5)||!num(b.corona.motion,0,3)))errors.push('Ungültige Sonnenkorona.');
    if(b?.air!==undefined&&(!b.air||b.kind!=='planet'||!num(b.air.extent,.005,.5)||!num(b.air.strength,0,5)||!color(b.air.color)))errors.push('Ungültige Planetenatmosphäre (Höhe 0,5–50 % des Radius).');
    if(b?.ring){const r=b.ring;if(b.kind!=='planet'||typeof r.enabled!=='boolean'||!num(r.inner,1.05,19)||!num(r.outer,r.inner+.05,20)||!color(r.color)||!num(r.opacity,0,1)||!num(r.density,0,1)||!Array.isArray(r.orientation)||r.orientation.length!==4||!r.orientation.every(v=>num(v,-1,1))||Math.abs(Math.hypot(...r.orientation)-1)>.001)errors.push('Ungültiger Planetenring.');}
  }
  if(l.bodies.filter(b=>b?.illuminates).length>4)errors.push('Höchstens vier Himmelskörper dürfen die Szene beleuchten.');
  if(l.primary!==null&&!l.bodies.some(b=>b?.id===l.primary&&b.illuminates))errors.push('Das Hauptlicht muss ein aktiver Himmelskörper sein.');
  for(const p of l.lamps){if(!p||!id(p.id)||ids.has(p.id)||!Object.hasOwn(LAMP_NAMES,p.kind)||!num(p.x,-400,400)||!num(p.z,-400,400)||!num(p.height,0,100)||!color(p.color)||!num(p.intensity,0,2000)||!num(p.range,1,150)||!num(p.azimuth,-180,180)||!num(p.elevation,-90,90)||!num(p.angle,5,85)||!['steady','pulse','flicker'].includes(p.pattern))errors.push('Ungültige lokale Lichtquelle.');if(p)ids.add(p.id);}
  return errors;
}
export function coreMask(g:RockGlow,p:readonly number[]){if(!g.core.enabled)return 0;const c=g.core,q=Math.hypot(...p.map((v,i)=>(v-c.center[i])/c.radii[i]));const t=Math.max(0,Math.min(1,(1-q)/c.softness));return t*t*(3-2*t);}
export function lampPulse(pattern:LocalLamp['pattern'],time:number){return pattern==='pulse'?.25+.75*(.5+.5*Math.sin(time*3))**3:pattern==='flicker'?.75+.15*Math.sin(time*17)+.1*Math.sin(time*31.7):1;}
