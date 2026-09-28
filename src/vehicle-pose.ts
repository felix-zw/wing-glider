/** Speeder bounds in game metres, including both nacelles and the long nose.
 * The conservative underside envelope also protects geometry between samples. */
export const HULL = { halfWidth: 3.05, front: -4.4, rear: 3.7, bottom: -.5, clearance: .7 } as const;
export interface VehiclePose { height: number; pitch: number; roll: number }
export type HeightSampler = (x: number, z: number) => number;
interface PoseInput { x: number; z: number; heading: number; hover: number; bank: number }
const clamp = (x: number, min: number, max: number) => Math.max(min, Math.min(max, x));

/** Transform a hull point using Three's YXZ order, with yaw = -heading. */
export function hullPoint(x: number, y: number, z: number, heading: number, pitch: number, roll: number) {
  const cr = Math.cos(roll), sr = Math.sin(roll), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const ch = Math.cos(heading), sh = Math.sin(heading);
  const rx = cr*x-sr*y, ry = sr*x+cr*y;
  const py = cp*ry-sp*z, pz = sp*ry+cp*z;
  return { x: ch*rx-sh*pz, y: py, z: sh*rx+ch*pz };
}

/** Invert the hull's horizontal basis. A full 3D inverse followed by discarding
 * Y would rotate the projected barrel bearing whenever the hull is banked. */
export function turretYaw(heading:number,pitch:number,roll:number,bearing:number) {
  const a=hullPoint(1,0,0,heading,pitch,roll), b=hullPoint(0,0,1,heading,pitch,roll);
  const x=Math.sin(bearing), z=-Math.cos(bearing), det=a.x*b.z-b.x*a.z;
  const localX=(b.z*x-b.x*z)/det,localZ=(-a.z*x+a.x*z)/det;
  return Math.atan2(-localX,-localZ);
}

/** Same GLB turret pivot and socket coordinates used by the rendered model. */
export function vehicleLaserOrigin(pose:VehiclePose,actor:{x:number;z:number;heading:number;turret:number}) {
  const yaw=turretYaw(actor.heading,pose.pitch,pose.roll,actor.turret);
  const p=hullPoint(-.99*Math.sin(yaw),1.08,.72-.99*Math.cos(yaw),actor.heading,pose.pitch,pose.roll);
  return {x:actor.x+p.x,y:pose.height+p.y,z:actor.z+p.z};
}

/** A footprint-sized average avoids reacting to individual sand ripples. The
 * heading remains authoritative, including while the vehicle is reversing. */
export function terrainAttitude(height: HeightSampler, x: number, z: number, heading: number) {
  const ch = Math.cos(heading), sh = Math.sin(heading);
  const sample = (right: number, forward: number) => height(x+ch*right+sh*forward,z+sh*right-ch*forward);
  let forward = 0, right = 0;
  for (const r of [-2.6,0,2.6]) forward += sample(r,3.6)-sample(r,-3.6);
  for (const f of [-3.6,0,3.6]) right += sample(2.6,f)-sample(-2.6,f);
  const pitch = clamp(Math.atan(forward/(3*7.2)),-.82,.82);
  const roll = clamp(Math.atan(right/(3*5.2)*Math.cos(pitch)),-.72,.72);
  return { pitch, roll };
}

/** Recheck clearance after smoothing, using the actual rendered attitude.
 * Lift immediately when necessary; settle down gently after a crest. */
export function vehiclePose(height: HeightSampler, input: PoseInput, previous: VehiclePose | null, dt: number): VehiclePose {
  const target = terrainAttitude(height,input.x,input.z,input.heading);
  const blend = previous ? 1-Math.exp(-Math.max(0,dt)*9) : 1;
  const pitch = previous ? previous.pitch+(target.pitch-previous.pitch)*blend : target.pitch;
  const targetRoll=target.roll+input.bank;
  const roll = previous ? previous.roll+(targetRoll-previous.roll)*blend : targetRoll;
  let minimum=-Infinity;
  for(let row=0;row<=4;row++) for(let column=0;column<=4;column++) {
    const p=hullPoint(-HULL.halfWidth+column*HULL.halfWidth/2,HULL.bottom,HULL.front+row*(HULL.rear-HULL.front)/4,input.heading,pitch,roll);
    minimum=Math.max(minimum,height(input.x+p.x,input.z+p.z)+HULL.clearance-p.y);
  }
  const wanted=Math.max(minimum,height(input.x,input.z)+input.hover);
  return {pitch,roll,height:Math.max(minimum,previous ? previous.height+(wanted-previous.height)*blend : wanted)};
}
