import { commonWgsl } from './common';

/** Soft contact shadows keep the small models grounded without shadow-map draws. */
export const landShadowShader = commonWgsl + /* wgsl */ `
struct Unit { a:vec4f, b:vec4f, c:vec4f, d:vec4f };
struct Params { count:u32, mode:u32, pad0:u32, pad1:u32 };
@group(1) @binding(0) var<storage,read> units:array<Unit>;
@group(1) @binding(1) var<uniform> params:Params;
struct ShadowOut {
  @builtin(position) position:vec4f,
  @location(0) uv:vec2f,
  @location(1) alpha:f32,
};
@vertex fn landShadowVertex(@builtin(vertex_index) vertex:u32,@builtin(instance_index) instance:u32)->ShadowOut {
  let unit=units[instance%params.count];
  let kind=u32(unit.a.w);
  let corners=array<vec2f,6>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(-1,1),vec2f(1,-1),vec2f(1,1));
  let radii=array<vec2f,4>(vec2f(.75,.75),vec2f(2.25,3.7),vec2f(2.9,4.7),vec2f(2.15,2.4));
  let corner=corners[vertex];let local=corner*radii[min(kind,3u)];
  let heading=select(unit.b.w,unit.c.w,(u32(unit.b.z)&8u)!=0u&&kind>0u);
  let offset=vec2f(local.x*cos(heading)-local.y*sin(heading),local.x*sin(heading)+local.y*cos(heading));
  let travel=select(0.0,clamp((uniforms.sunTime.w-unit.d.w)/max(.0001,unit.d.z),0.0,1.0),unit.d.z>0.0);
  let center=mix(unit.a.xy,unit.d.xy,travel)+vec2f(f32(i32(instance/params.count)-1)*uniforms.map.x,0);
  let xz=center+offset;
  var output:ShadowOut;
  output.position=uniforms.viewProjection*vec4f(xz.x,heightAt(xz/uniforms.map.xy)+.035,xz.y,1);
  output.uv=corner;
  output.alpha=select(.32,0.0,kind>3u)*(1.0-smoothstep(1500.0,1900.0,uniforms.interaction.y))
    *(1.0-horizontalWorldFog(xz.x));
  if((u32(unit.b.z)&16u)!=0u){output.alpha*=1.0-smoothstep(3.0,5.0,uniforms.sunTime.w-unit.c.y);}
  return output;
}
@fragment fn landShadowFragment(input:ShadowOut)->@location(0) vec4f {
  let alpha=(1.0-smoothstep(.15,1.0,length(input.uv)))*input.alpha;
  return vec4f(.025,.035,.025,alpha);
}
`;
