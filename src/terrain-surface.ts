import * as THREE from 'three';
import type { AssetLibrary } from './assets';
import { groundHeight, type LevelWorld } from './levels';
import { bedrockUplift } from './geology';

/** Weathering is strongest at outcrop feet; sheltered floors retain finer sand. */
export function groundGeology(world: LevelWorld, x: number, z: number) {
  const bedrock = Math.min(1, bedrockUplift(world,x,z)/14);
  let rock = bedrock, shelter = 0, mineral = 0, copper = 0;
  for (const solid of world.solids) if (solid.kind === 'cliff') {
    const distance = Math.hypot(Math.max(0, Math.abs(x - solid.x) - solid.halfX), Math.max(0, Math.abs(z - solid.z) - solid.halfZ));
    rock = Math.max(rock, Math.exp(-distance * distance / 90));
  }
  for (const deposit of world.deposits) if (deposit.surface?.kind === 'ground') {
    const dx = x - deposit.x, dz = z - deposit.z, surface = deposit.surface;
    const along = (-surface.nz * dx + surface.nx * dz) / (surface.width * .6 + 1);
    const across = (surface.nx * dx + surface.nz * dz) / 4.5;
    const influence = Math.exp(-along * along - across * across);
    rock = Math.max(rock, influence * .85);
    mineral = Math.max(mineral, influence);
    if (deposit.resource === 'copper') copper = Math.max(copper, influence);
  }
  for (const safe of world.shelters) {
    const distance = Math.hypot(x - safe.x, z - safe.z);
    shelter = Math.max(shelter, 1 - THREE.MathUtils.smoothstep(distance, safe.radius, safe.radius + 9));
  }
  return { rock: rock * (1 - shelter), shelter, bedrock:bedrock*(1-shelter), mineral: mineral * (1 - shelter), copper };
}

const surfaceShader = /* glsl */`
varying vec3 vLandPosition;
varying vec3 vLandNormal;
varying vec3 vGeology;
varying vec2 vMineralWeather;
uniform sampler2D landRock;
float landHash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * .1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float landNoise(vec2 p) {
  vec2 i=floor(p), t=fract(p), f=t*t*t*(t*(t*6.0-15.0)+10.0);
  vec2 a=normalize(vec2(landHash(i),landHash(i+31.7))*2.0-1.0+vec2(.0001));
  vec2 b=normalize(vec2(landHash(i+vec2(1,0)),landHash(i+vec2(1,0)+31.7))*2.0-1.0+vec2(.0001));
  vec2 c=normalize(vec2(landHash(i+vec2(0,1)),landHash(i+vec2(0,1)+31.7))*2.0-1.0+vec2(.0001));
  vec2 d=normalize(vec2(landHash(i+1.0),landHash(i+32.7))*2.0-1.0+vec2(.0001));
  return .5+.72*mix(mix(dot(a,t),dot(b,t-vec2(1,0)),f.x),mix(dot(c,t-vec2(0,1)),dot(d,t-1.0),f.x),f.y);
}
float landFbm(vec2 p) {
  mat2 turn = mat2(.8,-.6,.6,.8);
  return landNoise(p)*.57 + landNoise(turn*p*2.13+17.2)*.28 + landNoise(turn*p*4.37-8.6)*.15;
}
// Jittered cell interiors describe small fractured plates, without aligning
// visible grain to a square texture lattice.
float landPlate(vec2 p) {
  vec2 cell=floor(p), local=fract(p); float first=8.0, second=8.0;
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++) {
    vec2 offset=vec2(float(x),float(y));
    vec2 jitter=vec2(landHash(cell+offset),landHash(cell+offset+19.37));
    vec2 delta=offset+.12+jitter*.76-local;
    float distance=dot(delta,delta);
    if(distance<first) { second=first; first=distance; }
    else second=min(second,distance);
  }
  return smoothstep(.025,.22,second-first);
}
vec3 landBump(vec3 position, vec3 n, float height) {
  vec3 dx=dFdx(position), dy=dFdy(position);
  vec3 rx=cross(dy,n), ry=cross(n,dx);
  float determinant=dot(dx,rx);
  vec3 gradient=sign(determinant)*(dFdx(height)*rx+dFdy(height)*ry);
  return normalize(abs(determinant)*n-gradient);
}
`;

/** Albedo, relief and roughness use the same geological masks. The heightfield
 * itself stays authoritative for flight, shelter boundaries and ore anchors. */
export function createTerrain(world: LevelWorld, assets: AssetLibrary) {
  const extent=world.bounds*2+60;
  const geometry = new THREE.PlaneGeometry(extent, extent, 320, 320); geometry.rotateX(-Math.PI / 2);
  const positions = geometry.attributes.position, geology: number[] = [], mineralWeather: number[] = [];
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), z = positions.getZ(i), field = groundGeology(world, x, z);
    positions.setY(i, groundHeight(world, x, z)); geology.push(field.rock, field.shelter, field.bedrock);
    mineralWeather.push(field.mineral, field.copper);
  }
  geometry.setAttribute('geology', new THREE.Float32BufferAttribute(geology, 3)); geometry.computeVertexNormals();
  geometry.setAttribute('mineralWeather', new THREE.Float32BufferAttribute(mineralWeather, 2));
  const material = assets.material('sand');
  material.onBeforeCompile = shader => {
    shader.uniforms.landRock = { value: assets.surfaces.get('rock')!.color };
    shader.vertexShader = 'attribute vec3 geology; attribute vec2 mineralWeather; varying vec3 vLandPosition; varying vec3 vLandNormal; varying vec3 vGeology; varying vec2 vMineralWeather;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvLandPosition=position; vLandNormal=normal; vGeology=geology; vMineralWeather=mineralWeather;');
    shader.fragmentShader = surfaceShader + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', /* glsl */`
      vec2 landP = vLandPosition.xz;
      float landMacro = landFbm(landP*.026);
      vec2 landWarp = vec2(landFbm(landP*.047+3.1), landFbm(landP*.047-9.2));
      float landWeather = landFbm(landP*.19+landWarp*2.5);
      float landSlope = 1.0-smoothstep(.57,.93,normalize(vLandNormal).y);
      float landRockMask = clamp(landSlope*(.42+.48*smoothstep(.27,.70,landWeather)) + vGeology.x*.68
        + smoothstep(.47,.73,landWeather+landMacro*.13)*.58 - vGeology.y*.7, 0.0, 1.0);
      float landSandMask = 1.0-landRockMask;
      vec2 sandUv = landP*.09 + landWarp*.17;
      vec3 sandColor = mix(texture2D(map,sandUv).rgb,
        texture2D(map,mat2(.8,-.6,.6,.8)*sandUv*.71+4.3).rgb,.45);
      sandColor *= mix(vec3(1.10,1.10,1.09),vec3(.73,.80,.72),smoothstep(.29,.71,landMacro));
      vec3 weights=pow(abs(normalize(vLandNormal)),vec3(4.0)); weights/=dot(weights,vec3(1.0));
      vec3 rockColor = texture2D(landRock,vLandPosition.yz*.085+landWarp*.11).rgb*weights.x
        + texture2D(landRock,vLandPosition.xz*.085+landWarp*.11).rgb*weights.y
        + texture2D(landRock,vLandPosition.xy*.085+landWarp*.11).rgb*weights.z;
      rockColor *= mix(vec3(.76,.78,.72),vec3(.95,.93,.86),landWeather);
      vec3 bedrockColor=mix(vec3(.32,.29,.23),rockColor,.15)*vec3(.65,.59,.47);
      float landGrain=landNoise(landP*2.6);
      float grit=smoothstep(.57,.79,landGrain)*(landRockMask*.22+.045);
      float landCrust=landFbm(landP*.72+landWarp*4.0);
      float landPlateShape=landPlate(landP*1.35+landWarp*3.0);
      float landPlateCover=smoothstep(.48,.82,landRockMask)*smoothstep(.3,.7,landWeather);
      // The cliff texture's horizontal strata are muted on eroded ground. Use
      // broken mineral crust instead of tiling its cliff-scale crack lattice.
      rockColor = mix(vec3(.305,.285,.23),rockColor,.18)
        * mix(.52,1.32,smoothstep(.27,.72,landWeather*.68+landCrust*.32));
      rockColor *= mix(1.0,mix(.92,1.015,landPlateShape),landPlateCover);
      rockColor=mix(rockColor,bedrockColor,vGeology.z*.78);
      vec3 landColor=mix(sandColor,rockColor,landRockMask)*(1.0-grit*.45);
      vec3 mineralSoil=mix(vec3(.205,.212,.173),vec3(.255,.177,.104),vMineralWeather.y);
      landColor=mix(landColor,mineralSoil,vMineralWeather.x*(.24+landWeather*.3));
      diffuseColor.rgb *= landColor;
      // Broad, bent wind ripples only survive on loose sand. Their relief fades
      // below pixel resolution instead of turning into a regular moiré grid.
      float ripplePhase=landP.y*3.4+landP.x*.95+landWarp.x*16.0+landWeather*.65;
      float rippleAA=1.0-smoothstep(.65,2.4,fwidth(ripplePhase));
      float ripple=pow(.5+.5*sin(ripplePhase),3.0);
      float rippleCover=smoothstep(.24,.65,landWeather)*landSandMask;
      float landRelief=ripple*.065*rippleCover*rippleAA
        + landCrust*.12*landRockMask + landPlateShape*.009*landPlateCover
        + landGrain*.016;
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', 'normal=landBump(-vViewPosition,normal,landRelief);');
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', 'float roughnessFactor=mix(.96,.86,landRockMask);');
  };
  material.customProgramCacheKey = () => 'aster-embedded-bedrock-v3';
  const mesh = new THREE.Mesh(geometry, material); mesh.castShadow = mesh.receiveShadow = true; return mesh;
}
