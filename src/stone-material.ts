import * as THREE from 'three';
import type {SurfaceMaps} from './assets';
import type {SculptDefinition} from './sculpt';
import {newRockGlow,type RockGlow} from './lighting';

const coordinates=`
  uniform sampler2D stoneColor; uniform sampler2D stoneNormal; uniform sampler2D stoneOrm;
  uniform vec3 stoneOffset;uniform float stoneScale; uniform float stoneRelief; uniform float stoneAngular; uniform float stoneWeather;
  vec3 stoneWeights(vec3 n){vec3 w=pow(abs(n),vec3(5.));return w/max(dot(w,vec3(1.)),.0001);}
  vec3 stoneSample(sampler2D tex,vec3 p,vec3 n){
    vec3 w=stoneWeights(n);p=(p+stoneOffset)*stoneScale*.025;
    return texture2D(tex,p.yz+vec2(.173,.421)).rgb*w.x+texture2D(tex,p.zx+vec2(.617,.283)).rgb*w.y+texture2D(tex,p.xy+vec2(.349,.731)).rgb*w.z;
  }
  float stoneHeight(vec3 p,vec3 n,vec4 paint){
    float h=stoneSample(stoneOrm,p,n).b;
    return (h-.4)*stoneRelief*(1.-paint.y*.85)*(.4+paint.x*.6);
  }
`;
function uniforms(maps:SurfaceMaps,s:SculptDefinition){return {
  stoneColor:{value:maps.color},stoneNormal:{value:maps.normal},stoneOrm:{value:maps.orm},
  stoneOffset:{value:new THREE.Vector3((s.seed%97)*.731,(s.seed%53)*.419,(s.seed%127)*.317)},stoneScale:{value:s.material.scale},stoneRelief:{value:s.material.relief},stoneAngular:{value:s.material.angularity},stoneWeather:{value:s.material.weathering},
};}
export function stoneMaterial(maps:SurfaceMaps,tint:string,source:SculptDefinition,quality:'high'|'standard'){
  const m=new THREE.MeshStandardMaterial({color:new THREE.Color(tint).multiplyScalar(.82),roughness:.92,metalness:.04});
  m.userData.glow=source.glow;
  m.onBeforeCompile=shader=>{
    Object.assign(shader.uniforms,uniforms(maps,source));
    Object.assign(shader.uniforms,{rockEmission:{value:new THREE.Color()},rockPower:{value:0},rockCracks:{value:0},coreEmission:{value:new THREE.Color()},corePower:{value:0},coreCenter:{value:new THREE.Vector3()},coreRadii:{value:new THREE.Vector3(15,14,15)},coreSoftness:{value:.2}});
    m.userData.glowUniforms=shader.uniforms;setRockGlow(m,m.userData.glow);
    shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
      ${coordinates}
      attribute vec4 sculptPaint;attribute float sculptGlow;varying float vRockGlow;varying vec3 vStoneP;varying vec3 vStoneN;varying vec4 vStonePaint;
      varying vec3 vStoneX;varying vec3 vStoneY;varying vec3 vStoneZ;`)
      .replace('#include <begin_vertex>',`#include <begin_vertex>
        vStoneP=position;vStoneN=normal;vStonePaint=sculptPaint;vRockGlow=sculptGlow;
        vStoneX=normalMatrix*vec3(1.,0.,0.);vStoneY=normalMatrix*vec3(0.,1.,0.);vStoneZ=normalMatrix*vec3(0.,0.,1.);
        transformed+=normal*stoneHeight(position,normal,sculptPaint)*${quality==='high'?'2.2':'.65'};
      `);
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
      ${coordinates}
      varying vec3 vStoneP;varying vec3 vStoneN;varying vec4 vStonePaint;
      varying float vRockGlow;uniform vec3 rockEmission;uniform float rockPower;uniform float rockCracks;
      uniform vec3 coreEmission;uniform float corePower;uniform vec3 coreCenter;uniform vec3 coreRadii;uniform float coreSoftness;
      varying vec3 vStoneX;varying vec3 vStoneY;varying vec3 vStoneZ;
    `).replace('#include <map_fragment>',`#include <map_fragment>
      vec3 sn=normalize(vStoneN),sp=vStoneP;
      vec3 col=stoneSample(stoneColor,sp,sn);
      vec3 broad=stoneSample(stoneColor,sp*.273+vec3(19.1,7.3,31.7),sn);
      vec3 orm=stoneSample(stoneOrm,sp,sn);
      float fresh=vStonePaint.y,weather=clamp(vStonePaint.z+stoneWeather*.2,0.,1.);
      diffuseColor.rgb*=mix(col*.78+broad*.22,vec3(.53,.56,.57)*(col*.4+.6),fresh);
      diffuseColor.rgb*=mix(vec3(1.),vec3(.79,.73,.63),weather)*mix(1.,.62,vStonePaint.w);
      diffuseColor.rgb*=mix(.66,1.,orm.r);
    `).replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
      vec3 w=stoneWeights(sn),uv=(sp+stoneOffset)*stoneScale*.025;
      vec3 ax=texture2D(stoneNormal,uv.yz+vec2(.173,.421)).xyz*2.-1.;
      vec3 ay=texture2D(stoneNormal,uv.zx+vec2(.617,.283)).xyz*2.-1.;
      vec3 az=texture2D(stoneNormal,uv.xy+vec2(.349,.731)).xyz*2.-1.;
      vec3 grad=vec3(0.,ax.x,ax.y)*w.x+vec3(ay.y,0.,ay.x)*w.y+vec3(az.x,az.y,0.)*w.z;
      vec3 localN=normalize(sn+grad*(.35+stoneAngular)*stoneRelief*(1.-fresh*.8));
      #ifndef USE_INSTANCING
        normal=normalize(mat3(vStoneX,vStoneY,vStoneZ)*localN);
      #endif
    `).replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
      float fissure=mix(1.,1.-smoothstep(.24,.58,orm.b),rockCracks);
      float interior=1.-smoothstep(1.-coreSoftness,1.,length((vStoneP-coreCenter)/coreRadii));
      float innerFractures=mix(.035,.7,1.-smoothstep(.16,.5,orm.b))*(.6+.4*col.r);
      totalEmissiveRadiance+=rockEmission*rockPower*vRockGlow*fissure+coreEmission*corePower*interior*innerFractures;
    `).replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
      roughnessFactor=clamp(orm.g+weather*.1-fresh*.16,.48,1.);
    `);
  };
  m.customProgramCacheKey=()=>`stone-glow-v1-${quality}`;return m;
}
export function setRockGlow(material:THREE.MeshStandardMaterial,glow?:RockGlow){
  material.userData.glow=glow;const u=material.userData.glowUniforms;if(!u)return;const g=glow??newRockGlow();
  u.rockEmission.value.set(g.color);u.rockPower.value=glow?g.intensity:0;u.rockCracks.value=g.cracks;
  u.coreEmission.value.set(g.core.color);u.corePower.value=glow&&g.core.enabled?g.core.intensity:0;
  u.coreCenter.value.fromArray(g.core.center);u.coreRadii.value.fromArray(g.core.radii);u.coreSoftness.value=g.core.softness;
}
/** Shadows use precisely the same vertex offset as the colour pass. */
export function stoneDepth(maps:SurfaceMaps,source:SculptDefinition,quality:'high'|'standard'){
  const m=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking});
  m.onBeforeCompile=shader=>{
    Object.assign(shader.uniforms,uniforms(maps,source));
    shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>\n${coordinates}\nattribute vec4 sculptPaint;`)
      .replace('#include <begin_vertex>',`#include <begin_vertex>\ntransformed+=normal*stoneHeight(position,normal,sculptPaint)*${quality==='high'?'2.2':'.65'};`);
  };m.customProgramCacheKey=()=>`stone-depth-v2-${quality}`;return m;
}
