import { commonWgsl } from './common';
import { LAND_FIRE_PERIODS } from './land-animation-constants';

/** Skinned, textured land model. Animation palettes are baked from the GLB at load time. */
export const landModelShader = commonWgsl + /* wgsl */ `
struct ArmyModel { a: vec4f, b: vec4f, c: vec4f, d: vec4f };
struct ArmyModelParams { count: u32, mode: u32, pad0: u32, pad1: u32 };
@group(1) @binding(0) var<storage, read> armyModels: array<ArmyModel>;
@group(1) @binding(1) var<uniform> armyModelParams: ArmyModelParams;

struct LandAnimationParams {
  clips: array<vec4u, 8>,
  jointCount: u32,
  pad0: u32,
  pad1: u32,
  pad2: u32,
  sizing: vec4f,
  turret: vec4f,
};
@group(2) @binding(0) var<storage, read> animationFrames: array<mat4x4f>;
@group(2) @binding(1) var<uniform> animationParams: LandAnimationParams;
@group(2) @binding(2) var landMaterials: texture_2d_array<f32>;
@group(2) @binding(3) var landSampler: sampler;

fn landSkin(state: u32, phase: f32, joints: vec4u, weights: vec4f) -> mat4x4f {
  let clip = animationParams.clips[state];
  let continuous = select(fract(phase)*f32(clip.y),clamp(phase,0.0,.9999)*f32(clip.y-1u),state==6u||state==5u);
  let frame = u32(floor(continuous));
  let next = (frame + 1u) % clip.y;
  let a = (clip.x + frame) * animationParams.jointCount;
  let b = (clip.x + next) * animationParams.jointCount;
  if(weights.x>.9995){return animationFrames[a+joints.x]*(1.0-fract(continuous))+animationFrames[b+joints.x]*fract(continuous);}
  let first = animationFrames[a+joints.x]*weights.x + animationFrames[a+joints.y]*weights.y
    + animationFrames[a+joints.z]*weights.z + animationFrames[a+joints.w]*weights.w;
  let second = animationFrames[b+joints.x]*weights.x + animationFrames[b+joints.y]*weights.y
    + animationFrames[b+joints.z]*weights.z + animationFrames[b+joints.w]*weights.w;
  return first * (1.0-fract(continuous)) + second * fract(continuous);
}

fn unpackLandRgb(packed: f32) -> vec3f {
  let value = u32(packed + 0.5);
  return vec3f(f32((value >> 16u) & 255u), f32((value >> 8u) & 255u), f32(value & 255u)) / 255.0;
}

struct LandOut {
  @builtin(position) position: vec4f,
  @location(0) normal: vec3f,
  @location(1) uv: vec2f,
  @location(2) ownerColor: vec3f,
  @location(3) alpha: f32,
  @location(4) @interpolate(flat) selected: f32,
  @location(5) worldPosition: vec3f,
};

@vertex
fn landModelVertex(
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv: vec2f,
  @location(3) joints: vec4u,
  @location(4) weights: vec4f,
  @builtin(instance_index) instanceIndex: u32,
) -> LandOut {
  let copyIndex = instanceIndex / armyModelParams.count;
  let model = armyModels[instanceIndex % armyModelParams.count];
  let copyOffset = f32(i32(copyIndex) - 1) * uniforms.map.x;
  let flags = u32(model.b.z + 0.5);
  let moving = (flags & 2u) != 0u;
  let retreating = (flags & 4u) != 0u;
  let ship = model.a.w > 4.5;
  let engaged = (flags & 8u) != 0u && !ship;
  let legTravel = select(0.0, clamp((uniforms.sunTime.w-model.d.w)/max(model.d.z,.0001),0.0,1.0),model.d.z>0.0);
  let travelled = model.c.x + distance(model.d.xy,model.a.xy)*legTravel;
  let phase = model.c.y;
  var state = 0u;
  var clock = uniforms.sunTime.w / 2.0 + phase;
  if (moving) {
    state = select(1u,2u,retreating);
    clock = travelled / max(.01,animationParams.sizing.y*animationParams.sizing.x) + phase;
  } else if (engaged) {
    state = 3u;
    let periods = array<f32,4>(${LAND_FIRE_PERIODS.map((value) => value.toFixed(1)).join(',')});
    clock = uniforms.sunTime.w / periods[min(3u,u32(model.a.w))] + phase;
  }
  if (state==3u && model.a.w<.5 && u32(floor(clock))%4u==3u) { state=4u; }
  let dead=(flags&16u)!=0u;
  if(dead){state=6u;clock=(uniforms.sunTime.w-model.c.y)/2.0;}
  var skin=landSkin(state,clock,joints,weights);
  let blend=smoothstep(0.0,.3,uniforms.sunTime.w-model.c.z);
  if(!dead && blend<1.0){
    let previous=(flags>>8u)&7u;
    var previousClock=uniforms.sunTime.w/2.0+phase;
    if(previous==1u||previous==2u){previousClock=travelled/max(.01,animationParams.sizing.x*animationParams.sizing.y)+phase;}
    skin=landSkin(previous,previousClock,joints,weights)*(1.0-blend)+skin*blend;
  }
  let skinnedPosition = skin * vec4f(position, 1.0);
  let skinnedNormal = normalize((skin * vec4f(normal, 0.0)).xyz);

  let motion = smoothstep(0.0, 1.0, (uniforms.sunTime.w - model.d.w) / 0.42);
  var headingDelta = model.b.w - model.c.w;
  headingDelta -= 6.2831853 * round(headingDelta / 6.2831853);
  var heading = model.c.w + headingDelta * motion;
  let independentTurret=engaged && model.a.w>.5 && model.a.w<4.0;
  if(independentTurret){heading=model.c.w;}
  let cosine = cos(heading);
  let sine = sin(heading);
  // Authored metre units; one consistent map scale for every family.
  let scale = animationParams.sizing.x;
  // glTF character forward is +Z; map heading zero points north (-Z).
  var local = vec3f(skinnedPosition.x, skinnedPosition.y, -skinnedPosition.z) * scale;
  var localNormal = vec3f(skinnedNormal.x, skinnedNormal.y, -skinnedNormal.z);
  if(independentTurret && (f32(joints.x)==animationParams.sizing.z || f32(joints.x)==animationParams.sizing.w)){
    let pivot=animationParams.turret.xyz*vec3f(1.0,1.0,-1.0)*scale;
    let delta=model.b.w-model.c.w;let c=cos(delta);let s=sin(delta);
    let offset=local-pivot;
    local=pivot+vec3f(offset.x*c-offset.z*s,offset.y,offset.x*s+offset.z*c);
    localNormal=vec3f(localNormal.x*c-localNormal.z*s,localNormal.y,localNormal.x*s+localNormal.z*c);
  }
  // Low-amplitude sea motion is independent of the propeller animation.
  if(ship){
    let seaTime=uniforms.sunTime.w+phase*6.2831853;
    let roll=sin(seaTime*.85)*.018;let pitch=sin(seaTime*.61)*.009;
    local=vec3f(local.x*cos(roll)-local.y*sin(roll),local.x*sin(roll)+local.y*cos(roll),local.z);
    localNormal=vec3f(localNormal.x*cos(roll)-localNormal.y*sin(roll),localNormal.x*sin(roll)+localNormal.y*cos(roll),localNormal.z);
    local=vec3f(local.x,local.y*cos(pitch)-local.z*sin(pitch)+sin(seaTime*.72)*.055,local.y*sin(pitch)+local.z*cos(pitch));
    localNormal=vec3f(localNormal.x,localNormal.y*cos(pitch)-localNormal.z*sin(pitch),localNormal.y*sin(pitch)+localNormal.z*cos(pitch));
  }
  let rotated = vec3f(local.x * cosine - local.z * sine, local.y, local.x * sine + local.z * cosine);
  let rotatedNormal = normalize(vec3f(
    localNormal.x * cosine - localNormal.z * sine,
    localNormal.y,
    localNormal.x * sine + localNormal.z * cosine,
  ));
  let centerXZ = mix(model.a.xy, model.d.xy, legTravel) + vec2f(copyOffset, 0.0);
  var ground = heightAt(centerXZ / uniforms.map.xy);
  if(ship){ground=.35+oceanWaveHeight(centerXZ,1.0-bankAt(centerXZ/uniforms.map.xy));}
  let worldPosition = vec3f(centerXZ.x + rotated.x, ground + rotated.y + 0.12, centerXZ.y + rotated.z);
  var output: LandOut;
  output.position = uniforms.viewProjection * vec4f(worldPosition, 1.0);
  output.normal = rotatedNormal;
  output.uv = uv;
  output.ownerColor = unpackLandRgb(model.a.z);
  output.alpha = (1.0 - smoothstep(1500.0, 1900.0, uniforms.interaction.y))
    * (1.0 - mapFog(worldPosition.xz))
    * select(1.0,1.0-smoothstep(3.0,5.0,uniforms.sunTime.w-model.c.y),dead);
  output.selected = f32(flags & 1u);
  output.worldPosition = worldPosition;
  return output;
}

@fragment
fn landModelFragment(input: LandOut) -> @location(0) vec4f {
  let texel = textureSample(landMaterials, landSampler, input.uv, 0);
  if (texel.a < 0.1 || input.alpha < 0.01) { discard; }
  // Only the deliberately authored insignia tile takes faction colour.
  let insignia = step(.75,input.uv.x)*(1.0-step(.25,input.uv.y));
  let linearColor=pow(texel.rgb,vec3f(2.2));
  let albedo = mix(linearColor,linearColor*input.ownerColor*1.4,insignia);
  let material = textureSample(landMaterials,landSampler,input.uv,1);
  let detail = textureSample(landMaterials,landSampler,input.uv,2).xyz*2.0-1.0;
  // Derivative tangent frame avoids another per-vertex stream on every LOD.
  let px=dpdx(input.worldPosition); let py=dpdy(input.worldPosition);
  let tx=dpdx(input.uv); let ty=dpdy(input.uv);
  let n=normalize(input.normal);
  let tangent=normalize(px*ty.y-py*tx.y + vec3f(.000001));
  let bitangent=normalize(-px*ty.x+py*tx.x + vec3f(.000001));
  let normal=normalize(n*detail.z+tangent*detail.x+bitangent*detail.y);
  let light=normalize(uniforms.sunTime.xyz);
  let view=normalize(uniforms.camera.xyz-input.worldPosition);
  let halfVector=normalize(light+view);
  let roughness=clamp(material.g,.18,.98);
  let highlight=pow(max(0.0,dot(normal,halfVector)),mix(96.0,5.0,roughness));
  let specular=mix(vec3f(.04),albedo,material.b)*highlight*(1.0-roughness)*.6;
  var color=albedo*surfaceLight(normal)+specular;
  color += wetSurfaceSheen(input.normal, input.worldPosition) * texel.rgb;
  if (input.selected > 0.5) { color = mix(color, vec3f(1.0, 0.84, 0.40), 0.24); }
  return vec4f(pow(max(color,vec3f(0.0)),vec3f(1.0/2.2)), texel.a * input.alpha);
}
`;
