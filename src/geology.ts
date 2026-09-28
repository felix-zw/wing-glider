import type { LevelWorld, Solid } from './levels';

export type Cliff = Extract<Solid, { kind: 'cliff' }>;

/** The two sides of each canyon expose a common ridge. Positive across points
 * into the canyon; the wide backslope faces away from its navigable floor. */
export function cliffFacing(cliff: Cliff) {
  return Number(cliff.id.split('-').at(-1)) % 2 === 0 ? 1 : -1;
}

export function cliffUplift(cliff: Cliff, x: number, z: number) {
  const vertical = cliff.halfX < cliff.halfZ;
  const along = vertical ? z - cliff.z : x - cliff.x;
  const across = (vertical ? x - cliff.x : z - cliff.z) * cliffFacing(cliff);
  const length = Math.max(cliff.halfX, cliff.halfZ) + 32;
  const end = Math.max(0, 1 - (along / length) ** 2);
  const back = Math.min(1, Math.max(0, -across / 57));
  const profile = across >= 0 ? Math.exp(-((across / 4.6) ** 2)) : 1 - back * back * (3 - 2 * back);
  const erosion = .90 + .10 * Math.sin(along * .13 + cliff.x * .04 + cliff.z * .03);
  return cliff.height * .32 * end * end * profile * erosion;
}

export function bedrockUplift(world: LevelWorld, x: number, z: number) {
  let height = 0;
  for (const solid of world.solids) if (solid.kind === 'cliff') height = Math.max(height, cliffUplift(solid, x, z));
  return height;
}

/** GPU counterpart, used by terrain-following storm dust. Browser integration
 * compares this function against cliffUplift at canyon faces and outer slopes. */
export const cliffUpliftGLSL = /* glsl */`
float cliffUplift(vec4 cliff, vec2 shape, vec2 p) {
  vec2 offset=p-cliff.xy;
  float along=cliff.z<cliff.w?offset.y:offset.x;
  float across=(cliff.z<cliff.w?offset.x:offset.y)*shape.y;
  float length=max(cliff.z,cliff.w)+32.0;
  float end=max(0.0,1.0-along*along/(length*length));
  float back=clamp(-across/57.0,0.0,1.0);
  float profile=across>=0.0?exp(-pow(across/4.6,2.0)):1.0-back*back*(3.0-2.0*back);
  float erosion=.90+.10*sin(along*.13+cliff.x*.04+cliff.y*.03);
  return shape.x*.32*end*end*profile*erosion;
}`;
