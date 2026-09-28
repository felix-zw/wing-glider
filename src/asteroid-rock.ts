import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { getSolidFootprint, type Solid } from './levels';
import type { SurfaceMaps } from './assets';

type Asteroid = Extract<Solid, { kind: 'asteroid' }>;
type Point = { x: number; z: number };
type Face = [number, number, number];

const smooth = (a: number, b: number, x: number) => { const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const hash = (x: number, z: number, seed: number) => { const n = Math.sin(x * 127.1 + z * 311.7 + seed * 74.7) * 43758.5453; return n - Math.floor(n); };
function noise(x: number, z: number, seed: number) {
  const ix = Math.floor(x), iz = Math.floor(z), u = smooth(0, 1, x - ix), v = smooth(0, 1, z - iz);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(hash(ix, iz, seed), hash(ix + 1, iz, seed), u),
    THREE.MathUtils.lerp(hash(ix, iz + 1, seed), hash(ix + 1, iz + 1, seed), u), v);
}

/** Closed fractured volume. The entire -1..7.4 m mining band is exactly the
 * collision polygon. Caps use a shared irregular triangle mesh, never rings or
 * a polar fan, so faults and craters cannot form latitude stripes or pinching. */
export function createAsteroidGeometry(solid: Asteroid) {
  const boundary = getSolidFootprint(solid)!.map(p => ({ x: p.x - solid.x, z: p.z - solid.z }));
  const points: Point[] = boundary.map(p => ({ ...p }));
  let faces: Face[] = THREE.ShapeUtils.triangulateShape(boundary.map(p => new THREE.Vector2(p.x, p.z)), []).map(f => {
    const [a, b, c] = f, pa = points[a], pb = points[b], pc = points[c];
    return (pb.x - pa.x) * (pc.z - pa.z) - (pb.z - pa.z) * (pc.x - pa.x) > 0 ? [a, b, c] : [a, c, b];
  });
  const seed = solid.x * .23 + solid.z * .31 + solid.height * .13;
  const clearance = (p: Point) => {
    let d = Infinity;
    for (let i = 0; i < boundary.length; i++) {
      const a = boundary[i], b = boundary[(i + 1) % boundary.length], dx = b.x - a.x, dz = b.z - a.z;
      d = Math.min(d, (dx * (p.z - a.z) - dz * (p.x - a.x)) / Math.hypot(dx, dz));
    }
    return d;
  };
  // Shared midpoint subdivision keeps the surface watertight. Interior edge
  // points are staggered; boundary points stay exactly on their collision facet.
  for (let pass = 0; pass < 4; pass++) {
    const edges = new Map<string, number>(), next: Face[] = [];
    const midpoint = (a: number, b: number) => {
      const key = a < b ? `${a}:${b}` : `${b}:${a}`, cached = edges.get(key);
      if (cached !== undefined) return cached;
      const pa = points[a], pb = points[b], p = { x: (pa.x + pb.x) * .5, z: (pa.z + pb.z) * .5 };
      if (clearance(p) > .0001) {
        const amount = (hash(p.x, p.z, seed + pass) - .5) * .20;
        const shifted = { x: p.x + (pb.x - pa.x) * amount, z: p.z + (pb.z - pa.z) * amount };
        if (clearance(shifted) > .001) { p.x = shifted.x; p.z = shifted.z; }
      }
      const index = points.push(p) - 1; edges.set(key, index); return index;
    };
    for (const [a, b, c] of faces) {
      const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
      next.push([a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]);
    }
    faces = next;
  }
  const edgeUses = new Map<string, { a: number; b: number; uses: number }>();
  for (const [a, b, c] of faces) for (const [u, v] of [[a, b], [b, c], [c, a]]) {
    const key = u < v ? `${u}:${v}` : `${v}:${u}`, edge = edgeUses.get(key);
    if (edge) edge.uses++; else edgeUses.set(key, { a: u, b: v, uses: 1 });
  }
  const angle = hash(3, 5, seed) * Math.PI * 2, cs = Math.cos(angle), sn = Math.sin(angle);
  const craterX = (hash(1, 4, seed) - .5) * .66, craterZ = (hash(7, 1, seed) - .5) * .58;
  const surfaceHeight = (p: Point, upper: boolean) => {
    const x = p.x / solid.radius, z = p.z / solid.radius;
    const u = x * cs - z * sn, v = x * sn + z * cs;
    const inside = smooth(0, solid.radius * .66, clearance(p));
    const macro = noise(u * 2.7 + 4, v * 2.7 - 2, seed) - .5;
    const broken = noise(p.x * .27, p.z * .27, seed + 7) - .5;
    const chips = noise(p.x * .81, p.z * .81, seed + 19) - .5;
    // Three unequal angular shoulders replace a single rounded dome or peak.
    const shoulder = Math.max(0, .45 - Math.abs(u + .27) * .68 - Math.abs(v - .15) * .52,
      .36 - Math.abs(u - .24) * .58 - Math.abs(v + .20) * .75,
      .27 - Math.abs(u - .03) * .80 - Math.abs(v - .42) * .55);
    const fault = Math.max(0, 1 - Math.abs(u * .82 + v * .57 - .08) / .078) * inside;
    const craterDistance = Math.hypot(x - craterX, z - craterZ) / (.22 + hash(2, 9, seed) * .13);
    const crater = upper ? (1 - smooth(.38, 1, craterDistance)) * inside : 0;
    const rim = upper ? Math.exp(-Math.pow((craterDistance - 1) / .13, 2)) * inside * .035 : 0;
    const relief = .20 + inside * .26 + shoulder * (upper ? .74 : .49) + macro * .21 + broken * .12 + chips * .045
      - fault * .12 - crater * .20 + rim;
    return upper ? 7.4 + solid.height * Math.max(.075, relief) : -1 - solid.height * Math.max(.07, relief * .78);
  };
  const capPoint = (p: Point, upper: boolean) => {
    // Keep only the interaction band full-size. Unequal radial recession breaks
    // the prism outline above and below it while remaining inside the collider.
    const variation = noise(p.x / solid.radius * 2.3 + 1.7, p.z / solid.radius * 2.1 - 2.9, seed + (upper ? 31 : 43));
    const scale = upper ? .82 + variation * .12 : .55 + variation * .20;
    return new THREE.Vector3(solid.x + p.x * scale, surfaceHeight(p, upper), solid.z + p.z * scale);
  };
  const top = points.map(p => capPoint(p, true));
  const bottom = points.map(p => capPoint(p, false));
  const positions: number[] = [], colors: number[] = [], uvs: number[] = [];
  const normal = new THREE.Vector3(), ab = new THREE.Vector3(), ac = new THREE.Vector3();
  const cold = new THREE.Color('#9ca5ab'), warm = new THREE.Color('#aaa79c'), dark = new THREE.Color('#697984');
  const append = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
    normal.copy(ab.subVectors(b, a)).cross(ac.subVectors(c, a));
    if (normal.lengthSq() < 1e-12) return;
    const axis = Math.abs(normal.y) > Math.max(Math.abs(normal.x), Math.abs(normal.z)) ? 'top' : Math.abs(normal.x) > Math.abs(normal.z) ? 'side' : 'front';
    for (const p of [a, b, c]) {
      const broad = noise(p.x * .09, p.z * .09 + p.y * .12, seed), granular = noise(p.x * .63 + p.y * .31, p.z * .63, seed);
      const color = cold.clone().lerp(warm, broad * .30).lerp(dark, smooth(.38, .76, broad) * .40).multiplyScalar(.84 + granular * .22);
      positions.push(p.x, p.y, p.z); colors.push(color.r, color.g, color.b);
      uvs.push((axis === 'side' ? p.z : p.x) * .14, (axis === 'top' ? p.z : p.y) * .14);
    }
  };
  for (const [a, b, c] of faces) { append(top[a], top[c], top[b]); append(bottom[a], bottom[b], bottom[c]); }
  // Exact mining faces connect into chipped, tapering upper and lower shoulders.
  // No decoration can protrude into a navigable corridor or bury an ore anchor.
  for (const edge of edgeUses.values()) if (edge.uses === 1) {
    const { a, b } = edge;
    const shoulder = (index: number) => {
      const p = points[index], lower = new THREE.Vector3(solid.x + p.x, -1, solid.z + p.z);
      const upper = new THREE.Vector3(solid.x + p.x, 7.4, solid.z + p.z);
      const chip = noise(p.x * .22, p.z * .22, seed + 59);
      return [bottom[index], bottom[index].clone().lerp(lower, .50 + chip * .14), lower, upper,
        upper.clone().lerp(top[index], .42 + chip * .18), top[index]];
    };
    const sideA = shoulder(a), sideB = shoulder(b);
    let previousA = sideA[0], previousB = sideB[0];
    for (let step = 1; step < sideA.length; step++) {
      const nextA = sideA[step], nextB = sideB[step];
      append(previousA, nextA, previousB); append(previousB, nextA, nextB);
      previousA = nextA; previousB = nextB;
    }
  }
  // Closed, partly buried angular blocks create genuine shadowing and a broken
  // upper silhouette. They share this geometry/material, adding no draw calls.
  const crags: { x: number; z: number; radius: number }[] = [];
  const targetCrags = 19 + Math.floor(hash(7, 23, seed) * 6);
  for (let attempt = 0; crags.length < targetCrags && attempt < 700; attempt++) {
    const index = Math.floor(hash(attempt, 37, seed) * top.length), center = top[index];
    const width = 2.2 + hash(attempt, 41, seed) * 2.8, depth = 2.0 + hash(attempt, 43, seed) * 2.6;
    const height = 1.4 + hash(attempt, 47, seed) * 2.0;
    const radius = Math.hypot(width, depth) * .5;
    if (center.y < 9.5 + height * .5 || clearance({ x: center.x - solid.x, z: center.z - solid.z }) < radius + .12) continue;
    if (crags.some(p => Math.hypot(p.x - center.x, p.z - center.z) < (p.radius + radius) * .60)) continue;
    const yaw = hash(attempt, 53, seed) * Math.PI * 2, points: THREE.Vector3[] = [];
    for (let ring = 0; ring < 2; ring++) for (let corner = 0; corner < 6; corner++) {
      const angle = corner / 6 * Math.PI * 2 + yaw + ring * .17;
      const broken = .72 + hash(attempt * 7 + corner, ring + 59, seed) * .26;
      const x = Math.cos(angle) * width * .5 * broken, z = Math.sin(angle) * depth * .5 * broken;
      const y = (ring ? .43 + hash(corner, attempt, seed) * .22 : -.50) * height;
      points.push(new THREE.Vector3(center.x + x, center.y + height * .10 + y, center.z + z));
    }
    const block = new ConvexGeometry(points), p = block.getAttribute('position');
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < p.count; i += 3) append(a.fromBufferAttribute(p, i), b.fromBufferAttribute(p, i + 1), c.fromBufferAttribute(p, i + 2));
    block.dispose(); crags.push({ x: center.x, z: center.z, radius });
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}

/** Original local rock maps, desaturated and projected in object space. Fine
 * mineral grain and oblique fissures have no latitude or UV-pole dependence. */
export function createAsteroidMaterial(maps: SurfaceMaps) {
  const material = new THREE.MeshStandardMaterial({ map: maps.color, normalMap: maps.normal, roughnessMap: maps.orm,
    roughness: .98, metalness: .045, normalScale: new THREE.Vector2(.30, .30), vertexColors: true, flatShading: true });
  material.onBeforeCompile = shader => {
    shader.vertexShader = 'varying vec3 vRockPosition; varying vec3 vRockNormal;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvRockPosition=position;vRockNormal=normal;');
    shader.fragmentShader = `varying vec3 vRockPosition; varying vec3 vRockNormal;
      float rockHash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
      float rockNoise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
        return mix(mix(mix(rockHash(i),rockHash(i+vec3(1,0,0)),f.x),mix(rockHash(i+vec3(0,1,0)),rockHash(i+vec3(1,1,0)),f.x),f.y),
          mix(mix(rockHash(i+vec3(0,0,1)),rockHash(i+vec3(1,0,1)),f.x),mix(rockHash(i+vec3(0,1,1)),rockHash(i+vec3(1,1,1)),f.x),f.y),f.z);}
      float rockFissures(vec2 p){
        vec2 cell=floor(p),f=fract(p),nearestCell=cell;
        float first=10.0,second=10.0;
        for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
          vec2 offset=vec2(float(x),float(y)),id=cell+offset;
          vec2 site=.12+.76*vec2(rockHash(vec3(id,3.7)),rockHash(vec3(id,19.3)));
          vec2 delta=offset+site-f;float d=dot(delta,delta);
          if(d<first){second=first;first=d;nearestCell=id;}else{second=min(second,d);}
        }
        float gap=sqrt(second)-sqrt(first),aa=max(fwidth(gap),.001);
        float edge=1.0-smoothstep(.006-aa,.018+aa,gap);
        // Sparse broken polygon edges, never closed noise-isovalue contour loops.
        float selected=step(.51,rockHash(vec3(nearestCell,41.7)));
        float broken=smoothstep(.28,.65,rockNoise(vec3(p*.71,7.3)));
        return edge*selected*broken;
      }
      ` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
      vec3 weight=pow(abs(normalize(vRockNormal)),vec3(5.0));weight/=max(dot(weight,vec3(1.0)),.0001);
      vec3 sampleRock=texture2D(map,vRockPosition.yz*.14).rgb*weight.x+texture2D(map,vRockPosition.xz*.14).rgb*weight.y+texture2D(map,vRockPosition.xy*.14).rgb*weight.z;
      float stone=dot(sampleRock,vec3(.2126,.7152,.0722));
      vec2 fracturePlane=weight.x>weight.y&&weight.x>weight.z?vRockPosition.yz:weight.y>weight.z?vRockPosition.xz:vRockPosition.xy;
      float fracture=rockFissures(fracturePlane*.94+vec2(13.7,-8.3));
      float grain=.90+rockNoise(vRockPosition*3.7)*.18;
      float broad=mix(.47,1.15,smoothstep(.25,.78,rockNoise(vRockPosition*.105+vec3(4.7,1.3,-2.8))));
      diffuseColor.rgb*=vec3(.91,.98,1.025)*(.15+stone*.36)*grain*broad*(1.0-fracture*.22);
    `);
  };
  material.customProgramCacheKey = () => 'fractured-asteroid-stone-v3';
  return material;
}
