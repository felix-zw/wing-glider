import { ATLAS, atlasPlacement, atlasPoint, atlasDriveSurface, mix, smooth, type Vec3 } from './atlas-rig';
import { groundHeight, type LevelWorld } from './levels';
import { CONFIG, SPACE } from './config';
import { vehiclePose, type VehiclePose } from './vehicle-pose';

export const DEPLOY_SECONDS=8;
export type DeploymentPhase='arrival'|'opening'|'deploying'|'ready';
export interface DeploymentState { time:number; phase:DeploymentPhase }
export interface DeploymentFrame {
  phase:DeploymentPhase; shipOffset:Vec3; gear:number; door:number; ramp:number;
  lift:number; brake:number; drive:number; camera:number;
  player:Vec3 & VehiclePose & {heading:number;vx:number;vz:number};
}
export const deploymentPhase=(t:number):DeploymentPhase=>t<2.5?'arrival':t<4?'opening':t<DEPLOY_SECONDS?'deploying':'ready';
export const deploymentActive=(d:DeploymentState|null)=>!!d&&d.phase!=='ready';

/** A single absolute clock drives simulation, rig, effects and audio. No render-time timers. */
export function deploymentFrame(world:LevelWorld,time:number):DeploymentFrame {
  const t=Math.max(0,Math.min(DEPLOY_SECONDS,time)),p=atlasPlacement(world),space=world.definition.environment==='space';
  const arrival=smooth(t/2.5),gear=smooth((t-.35)/1.3),door=smooth((t-2.5)/.9),ramp=smooth((t-3.35)/.65);
  const shipOffset=space?{x:Math.sin(p.yaw)*(1-arrival)*10,y:0,z:Math.cos(p.yaw)*(1-arrival)*10}
    :{x:0,y:18*(1-arrival)+(t>1.85&&t<2.5?Math.sin((t-1.85)/.65*Math.PI)*.13:0),z:0};
  const u=Math.max(0,(t-4)/4),distance=p.distance+ATLAS.exitClearance-ATLAS.bayZ;
  // Hermite endpoint velocities: gentle coast in space, stationary on a planet.
  const endSpeed=space?4:0,travel=distance*smooth(u)+4*endSpeed*(u*u*u-u*u);
  const speed=t<=4?0:(distance*(6*u-6*u*u)+4*endSpeed*(3*u*u-2*u))/4;
  const point=atlasPoint(p,0,ATLAS.bayHover,ATLAS.bayZ+travel);
  point.x+=shipOffset.x;point.y+=shipOffset.y;point.z+=shipOffset.z;
  const heading=Math.atan2(Math.sin(p.yaw),-Math.cos(p.yaw));
  let pose:VehiclePose;
  if(space)pose={height:SPACE.flightHeight,pitch:0,roll:0};
  else if(t<=4)pose={height:point.y,pitch:0,roll:0};
  else {
    const support=(x:number,z:number)=>atlasDriveSurface(world,p,x,z);
    pose=vehiclePose(support,{...point,heading,hover:mix(ATLAS.bayHover,CONFIG.hoverHeight,smooth((travel-(p.distance-ATLAS.bayZ))/8)),bank:0},null,0);
    // Exact normal flight pose at the endpoint; no height/attitude pop at handoff.
    if(t===DEPLOY_SECONDS)pose=vehiclePose((x,z)=>groundHeight(world,x,z),{...point,heading,hover:CONFIG.hoverHeight,bank:0},null,0);
  }
  point.y=pose.height;
  return {phase:deploymentPhase(t),shipOffset,gear,door,ramp,
    lift:!space&&t<2.7?(1-smooth((t-2.05)/.65))*(.65+.25*Math.sin(t*1.2)**2):0,
    brake:space&&t<2.5?Math.sin(Math.PI*arrival)*.9:0,
    drive:t>4&&t<7.65?Math.min(1,speed/8):0,camera:1-smooth((t-5.8)/2.2),
    player:{...point,...pose,heading,vx:Math.sin(p.yaw)*Math.max(0,speed),vz:Math.cos(p.yaw)*Math.max(0,speed)}};
}
