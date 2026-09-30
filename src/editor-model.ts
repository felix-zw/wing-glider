import {cloneDocument,validateDocument,type LevelDocument,type LevelIssue} from './level-document';
import {compileLevel} from './levels';
import {contains,sweep} from './collision';
import {COLLISION,SPACE} from './config';
import {findRoute} from './navigation';
import {THEMES,type ThemeDefinition} from './themes';
import {atlasPlacement} from './atlas-rig';
import {getSculpt} from './sculpt-runtime';

export interface EditorSnapshot {level:LevelDocument;theme:ThemeDefinition;selection:string|null}
/** Document history never includes mutable mining/flight state. */
export class EditorHistory {
  private undoStack:EditorSnapshot[]=[];private redoStack:EditorSnapshot[]=[];
  constructor(public current:EditorSnapshot){}
  change(edit:(snapshot:EditorSnapshot)=>void){const previous=this.current;this.current=structuredClone(previous);edit(this.current);if(JSON.stringify(previous)===JSON.stringify(this.current)){this.current=previous;return;}this.undoStack.push(previous);if(this.undoStack.length>100)this.undoStack.shift();this.redoStack=[];}
  undo(){const previous=this.undoStack.pop();if(!previous)return false;this.redoStack.push(structuredClone(this.current));this.current=previous;return true;}
  redo(){const next=this.redoStack.pop();if(!next)return false;this.undoStack.push(structuredClone(this.current));this.current=next;return true;}
  get canUndo(){return this.undoStack.length>0;}get canRedo(){return this.redoStack.length>0;}
}
export function inspectLevel(document:LevelDocument,compiled?:import('./levels').LevelWorld):LevelIssue[]{
  const issues=validateDocument(document);if(issues.some(i=>i.severity==='error'))return issues;
  const world=compiled??compileLevel(document), add=(severity:'warning'|'error',message:string,objectId?:string)=>issues.push({severity,message,objectId});
  for(const object of document.objects)if(object.assetId==='sculpt-asteroid'){
    const compiled=getSculpt(document.id,object.id);
    if(compiled&&(compiled.high.indices.length/3>40000||compiled.standard.indices.length/3>12000))
      add('error','Modell überschreitet das Dreieckslimit (High 40.000 / Standard 12.000).',object.id);
  }
  const atlas=atlasPlacement(world);if(!atlas.valid)add('error',atlas.reason,'base');
  const outside=(p:{x:number;z:number},r=0)=>Math.abs(p.x)+r>world.bounds-3||Math.abs(p.z)+r>world.bounds-3;
  if(outside(world.spawn,COLLISION.shipRadius)||world.solids.some(s=>contains(s,world.spawn,COLLISION.shipRadius)))add('error','Startpunkt liegt außerhalb des Flugraums oder im Fels.','spawn');
  if(outside(world.base,world.base.radius)||world.solids.some(s=>contains(s,world.base,world.base.radius+2)))add('error','ATLAS-Ladezone ist blockiert oder außerhalb des Levels.','base');
  if(document.environment==='planet'&&!world.shelters.length)add('warning','Der Planet enthält keinen Schutzbereich.');
  for(const s of world.solids){
    if(outside(s))add('warning','Felsmittelpunkt liegt außerhalb des Levels.',s.id);
    if(world.solids.some(other=>other!==s&&(contains(other,s,2)||contains(s,other,2))))add('warning','Felsformationen überschneiden sich.',s.id);
  }
  for(const deposit of world.deposits){
    if(deposit.surface?.invalid){add('error','Erzstelle hat ihre tragende Felsoberfläche verloren.',deposit.id);continue;}
    const n=deposit.surface!,point={x:deposit.x+n.nx*10,z:deposit.z+n.nz*10};
    if(outside(point,COLLISION.shipRadius)||world.solids.some(s=>contains(s,point,COLLISION.shipRadius))||!findRoute(world,world.spawn,point).length)add('warning','Erzstelle hat keinen freien Anflug.',deposit.id);
  }
  for(const r of ['ferrite','copper','crystal'] as const)if(world.deposits.filter(d=>d.resource===r).reduce((n,d)=>n+d.remaining,0)<document.delivery[r])add('warning','Zu wenig '+r+' für das Lieferziel.');
  if(!findRoute(world,world.spawn,world.base).length)add('error','ATLAS ist vom Startpunkt aus nicht erreichbar.','base');
  return issues;
}
