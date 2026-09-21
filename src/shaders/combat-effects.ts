import { commonWgsl } from './common';

/**
 * World-space instanced combat effects, fed by CombatEffectPool.collect().
 *
 * One `pass.draw(6, N)` billboarded quad per effect. The CPU packs 12 floats
 * per instance:
 *   a = (worldX, worldZ, kind, age01)
 *   b = (seed, scale, intensity, dir)   dir in radians, -999 = none
 *
 * kind: 0 muzzle flash, 1 tracer, 2 projectile, 3 impact, 4 dust, 5 smoke,
 *       6 explosion, 7 target flash, 8 battle marker (age01 = pulse phase),
 *       9 debris.
 *
 * Alpha-blended (same as every other overlay pipeline) — "heat" comes from
 * bright cores and soft edges, not additive accumulation, so an effect over
 * bright terrain still reads and a dense cluster never blows out to white.
 */
export const combatEffectShader = commonWgsl + /* wgsl */ `
struct Effect { a: vec4f, b: vec4f, c: vec4f };
struct EffectParams { count: u32, mode: u32, pad0: u32, pad1: u32 };
@group(1) @binding(0) var<storage, read> effects: array<Effect>;
@group(1) @binding(1) var<uniform> effectParams: EffectParams;
@group(2) @binding(0) var effectAtlas: texture_2d<f32>;
@group(2) @binding(1) var effectSampler: sampler;

struct EffectOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) kind: f32,
  @location(2) @interpolate(flat) age: f32,
  @location(3) @interpolate(flat) seed: f32,
  @location(4) @interpolate(flat) intensity: f32,
  @location(5) @interpolate(flat) dir: f32,
  @location(6) alpha: f32,
};

// Base half-size in pixels for a kind before the per-instance scale + zoom.
fn effectPixelSize(kind: i32) -> f32 {
  switch (kind) {
    case 0: { return 16.0; }   // muzzle flash
    case 1: { return 22.0; }   // tracer
    case 2: { return 7.0; }    // projectile
    case 3: { return 24.0; }   // impact
    case 4: { return 34.0; }   // dust
    case 5: { return 44.0; }   // smoke
    case 6: { return 52.0; }   // explosion
    case 7: { return 30.0; }   // target flash
    case 9: { return 8.0; }    // debris
    default: { return 32.0; }  // battle marker
  }
}

@vertex
fn combatEffectVertex(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32,
) -> EffectOut {
  let copyIndex = instanceIndex / effectParams.count;
  let effect = effects[instanceIndex % effectParams.count];
  let copyOffset = f32(i32(copyIndex) - 1) * uniforms.map.x;
  let corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
  );
  let corner = corners[vertexIndex];

  let kind = i32(effect.a.z + 0.5);
  let age = clamp(effect.a.w, 0.0, 1.0);
  let dir = effect.b.w;

  // Projectiles / tracers travel from the spawn point along dir over their life.
  var worldXZ = vec2f(effect.a.x, effect.a.y);
  if ((kind == 2 || kind == 1) && dir > -900.0) {
    let travel = effect.c.y * age;
    worldXZ += vec2f(cos(dir), sin(dir)) * travel;
  }
  if (kind == 9 && dir > -900.0) {
    // Tiny ballistic debris: cheap horizontal scatter plus a single parabolic
    // lift. No physics objects, collision bodies, or per-particle CPU updates.
    let travel = select(58.0,effect.c.y,effect.c.w>0.0) * age;
    worldXZ += vec2f(cos(dir), sin(dir)) * travel;
  }
  let uvGround = worldXZ / uniforms.map.xy;
  let ground = heightAt(uvGround);
  var rise = select(0.0, age * select(26.0,effect.c.w*1.3,effect.c.w>0.0), kind == 4 || kind == 5); // dust / smoke drift up
  if (kind == 9) { rise = max(0.0, sin(age * 3.14159265) * 34.0 - age * 5.0); }
  var height = effect.c.x;
  if (kind == 1 || kind == 2) { height = mix(effect.c.x,.15,age)+sin(age*3.14159265)*effect.c.z; }
  if (kind == 9 && effect.c.w > 0.0) { rise=sin(age*3.14159265)*effect.c.z; }
  let worldPos = vec3f(worldXZ.x + copyOffset, ground + height + rise, worldXZ.y);
  let clip = uniforms.viewProjection * vec4f(worldPos, 1.0);

  // Grow with age for the puff kinds, snap-then-shrink for the flash kinds.
  var sizeAge = 1.0;
  if (kind == 3 || kind == 6) { sizeAge = mix(0.35, 1.35, sqrt(age)); }
  else if (kind == 4 || kind == 5) { sizeAge = mix(0.5, 1.5, age); }
  else if (kind == 0) { sizeAge = mix(1.2, 0.4, age); }
  else if (kind == 7) { sizeAge = mix(1.6, 0.7, age); }
  else if (kind == 8) { sizeAge = 1.0 + 0.12 * sin(effect.a.w * 6.2831853); }

  let zoom = uniforms.interaction.y;
  let zoomScale = mix(0.7, 1.35, smoothstep(4600.0, 700.0, zoom));
  // The battle marker is a strategic-awareness pin: it must not shrink away as
  // the player pulls back to survey the front. Hold it near full size up close
  // and let it grow as the camera climbs so clustered fights stay readable on
  // the strategic map.
  let markerZoomScale = mix(1.0, 1.7, smoothstep(1500.0, 9000.0, zoom));
  let effZoomScale = select(zoomScale, markerZoomScale, kind == 8);
  var half = effectPixelSize(kind) * max(0.15, effect.b.y) * sizeAge * effZoomScale * uniforms.viewport.z;

  if (effect.c.w > 0.0) {
    let upClip=uniforms.viewProjection*vec4f(worldPos+vec3f(0.0,effect.c.w,0.0),1.0);
    half=length((upClip.xy/max(.001,upClip.w)-clip.xy/max(.001,clip.w))*uniforms.viewport.xy*.5)*sizeAge;
    half=clamp(half,.4,100.0);
  }

  // Fade: transients fade over their life; the battle marker holds (its pulse
  // is size + fragment glow) and — unlike every transient — stays at full
  // opacity all the way out to max zoom, since that is exactly when the player
  // needs to see where the fighting is.
  let lifeFade = select(1.0 - smoothstep(0.55, 1.0, age), 0.85 + 0.15 * sin(effect.a.w * 6.2831853), kind == 8);
  let zoomFade = select(1.0 - smoothstep(4400.0, 5000.0, zoom), 1.0, kind == 8);

  var output: EffectOut;
  output.uv = corner;
  output.kind = effect.a.z;
  output.age = age;
  output.seed = effect.b.x;
  output.intensity = clamp(effect.b.z, 0.0, 4.0);
  output.dir = dir;
  output.alpha = lifeFade * zoomFade * (1.0 - horizontalWorldFog(worldPos.x));
  if (clip.w <= 0.0001) {
    output.position = vec4f(0.0, 0.0, -10.0, 1.0);
    output.alpha = 0.0;
    return output;
  }
  var pixelOffset = corner * half * 2.0 / uniforms.viewport.xy;
  if (kind == 1 && dir > -900.0) {
    // Orient the tracer in the actual projected world-space firing direction.
    // The previous effect was always horizontal in screen space, which made a
    // diagonal or vertical shot look detached from the combatants.
    let aheadWorld = vec3f(
      worldPos.x + cos(dir) * 24.0,
      worldPos.y,
      worldPos.z + sin(dir) * 24.0,
    );
    let aheadClip = uniforms.viewProjection * vec4f(aheadWorld, 1.0);
    if (aheadClip.w > 0.0001) {
      let deltaPx = (aheadClip.xy / aheadClip.w - clip.xy / clip.w) * uniforms.viewport.xy * 0.5;
      let deltaLen = length(deltaPx);
      if (deltaLen > 0.01) {
        let axis = deltaPx / deltaLen;
        let normal = vec2f(-axis.y, axis.x);
        let orientedPx = axis * (corner.x * half * 1.75) + normal * (corner.y * half * 0.20);
        pixelOffset = orientedPx * 2.0 / uniforms.viewport.xy;
      }
    }
  }
  output.position = clip + vec4f(pixelOffset * clip.w, 0.0, 0.0);
  return output;
}

fn softDisc(uv: vec2f, edge: f32) -> f32 {
  return 1.0 - smoothstep(edge, 1.0, length(uv));
}

fn ring(uv: vec2f, radius: f32, width: f32) -> f32 {
  return 1.0 - smoothstep(width, width * 2.4, abs(length(uv) - radius));
}

// Three-octave value-noise turbulence, ~0..0.875, mean ~0.4. Used to break the
// circular silhouette off the explosion and battle smoke so neither reads as a
// painted disc or ring.
fn turbulence(p: vec2f) -> f32 {
  var f = 0.0;
  var amp = 0.5;
  var q = p;
  for (var i = 0; i < 3; i = i + 1) {
    f = f + amp * valueNoise(q);
    q = q * 2.03;
    amp = amp * 0.5;
  }
  return f;
}

@fragment
fn combatEffectFragment(input: EffectOut) -> @location(0) vec4f {
  if (input.alpha < 0.01) { discard; }
  let uv = input.uv;
  let kind = i32(input.kind + 0.5);
  let r = length(uv);
  if (r > 1.02 && kind != 1) { discard; }

  var rgb = vec3f(0.0);
  var a = 0.0;

  if (kind == 0) {                        // muzzle flash — hot star
    let core = softDisc(uv, 0.0) * 1.2;
    let spikes = softDisc(uv*vec2f(.8,2.2),.05)*(0.5+valueNoise(uv*8.0+input.seed*19.0));
    let f = clamp(core + spikes * 0.5, 0.0, 1.0);
    rgb = mix(vec3f(1.0, 0.86, 0.45), vec3f(1.0, 1.0, 0.95), core);
    a = f;
  } else if (kind == 1) {
    // Tracer — thin streak with a white-hot core cooling to amber at both
    // tips. This billboard is screen-aligned, not rotated to travel dir
    // (see the vertex stage above), so a one-sided bright-head/dim-tail
    // gradient would point the wrong way whenever the camera is rotated off
    // the firing direction. A center-hot, symmetric gradient instead reads
    // as "a glowing round in flight" from any camera angle, distinguishing
    // it from the flat-colored bar it used to be and from the plain dot used
    // for kind 2 (projectile).
    let d = abs(uv.y) + max(0.0, abs(uv.x) - 0.85) * 4.0;
    let envelope = clamp(1.0 - d * 3.0, 0.0, 1.0);
    let heat = 1.0 - smoothstep(0.0, 0.8, abs(uv.x)); // hottest at center, cooling toward both tips
    a = envelope * (0.6 + 0.4 * input.seed) * mix(0.88, 1.0, heat);
    rgb = mix(vec3f(1.0, 0.78, 0.35), vec3f(1.0, 0.97, 0.85), heat);
  } else if (kind == 2) {                 // projectile — bright dot + tail
    a = softDisc(uv * 1.4, 0.0);
    rgb = vec3f(1.0, 0.9, 0.7);
  } else if (kind == 3) {                 // impact — expanding ring + spark
    a = softDisc(uv * vec2f(1.0,1.7), .05) * (0.35 + .65*turbulence(uv*6.0+input.seed*31.0));
    rgb = vec3f(0.95, 0.93, 0.86);
  } else if (kind == 4) {                 // dust — soft brown puff, billowing
    let n = valueNoise(uv * 3.0 + input.seed * 40.0) * 0.7
          + valueNoise(uv * 6.5 - input.seed * 12.0) * 0.3;
    a = softDisc(uv, 0.1) * (0.35 + 0.55 * n) * 0.72;
    rgb = mix(vec3f(0.52, 0.43, 0.31), vec3f(0.70, 0.62, 0.50), n);
  } else if (kind == 5) {                 // smoke — dark grey puff, curling up
    let n = valueNoise(uv * 2.4 + input.seed * 27.0 + vec2f(input.age * 1.5, -input.age * 2.0)) * 0.7
          + valueNoise(uv * 5.0 + input.seed * 9.0 - vec2f(0.0, input.age * 3.0)) * 0.3;
    a = softDisc(uv, 0.05) * (0.30 + 0.55 * n) * 0.64;
    rgb = mix(vec3f(0.12, 0.12, 0.13), vec3f(0.32, 0.31, 0.29), n);
  } else if (kind == 6) {
    // Explosion, composited bottom-up: ground dust skirt -> rolling smoke that
    // lifts and greys as it ages -> orange fireball with a white-hot core that
    // is spent by ~60% life -> a scatter of bright embers fading to red. Reads
    // as a battlefield burst rather than an expanding coloured disc.
    let rise = vec2f(0.0, -input.age * 0.55);
    let turb = valueNoise(uv * 2.3 + rise * 3.0 + input.seed * 51.0)
             + valueNoise(uv * 5.1 - rise * 2.0 + input.seed * 17.0) * 0.5;
    let billow = clamp(turb / 1.5, 0.0, 1.0);
    let rr = length(uv * vec2f(1.0, 1.12) - rise);

    let fireLife = 1.0 - smoothstep(0.0, 0.55, input.age);
    let fireBody = (1.0 - smoothstep(0.12, 0.78 + billow * 0.25, rr)) * fireLife;
    let hotCore = (1.0 - smoothstep(0.0, 0.30, rr)) * fireLife;
    let fireCol = mix(vec3f(1.0, 0.45, 0.12), vec3f(1.0, 0.93, 0.66), hotCore);

    let smokeLife = smoothstep(0.06, 0.5, input.age) * (1.0 - smoothstep(0.72, 1.0, input.age));
    let smokeBody = (1.0 - smoothstep(0.15, 0.95, rr)) * (0.35 + 0.65 * billow) * smokeLife;
    let smokeCol = mix(vec3f(0.16, 0.15, 0.15), vec3f(0.40, 0.35, 0.30), billow);

    let dustLife = 1.0 - smoothstep(0.0, 0.4, input.age);
    let ground = uv.y + 0.35;
    let dust = (1.0 - smoothstep(0.2, 1.0, length(vec2f(uv.x * 0.7, ground * 2.4))))
             * step(ground, 0.35) * dustLife * (0.4 + 0.5 * billow);

    let emberField = valueNoise(uv * 9.0 + input.seed * 120.0);
    let ember = smoothstep(0.86, 0.98, emberField)
              * (1.0 - smoothstep(0.2, 0.95, input.age)) * step(0.25, rr);
    let emberCol = mix(vec3f(1.0, 0.8, 0.3), vec3f(0.9, 0.25, 0.1), input.age);

    var col = vec3f(0.52, 0.44, 0.34);
    var cov = dust;
    col = mix(col, smokeCol, smokeBody);
    cov = max(cov, smokeBody);
    col = mix(col, fireCol, fireBody);
    cov = max(cov, fireBody * 1.1);
    col += emberCol * ember * 1.3;
    cov = clamp(max(cov, ember), 0.0, 1.0);
    rgb = clamp(col, vec3f(0.0), vec3f(1.0));
    a = cov;
  } else if (kind == 7) {                 // target flash — red reticle
    let cross = max(
      step(abs(uv.x), 0.06) * step(abs(uv.y), 0.85),
      step(abs(uv.y), 0.06) * step(abs(uv.x), 0.85),
    );
    a = clamp(ring(uv, 0.78, 0.05) + cross, 0.0, 1.0);
    rgb = vec3f(0.95, 0.28, 0.20);
  } else if (kind == 9) {                 // debris — a few tumbling dark fragments
    let spin = input.age * 9.0 + input.seed * 6.2831853;
    let cs = cos(spin);
    let sn = sin(spin);
    let p = vec2f(cs * uv.x - sn * uv.y, sn * uv.x + cs * uv.y);
    let box = max(abs(p.x) * 0.85, abs(p.y) * 2.2);
    a = 1.0 - smoothstep(0.45, 0.82, box);
    rgb = mix(vec3f(0.12, 0.105, 0.085), vec3f(0.28, 0.22, 0.15), input.seed);
  } else {                                // battle marker — a smouldering smoke plume, no ring or cross
    // A pulsing ring / crossed-blades "X" both read as HUD chrome. A turbulent
    // dark smoke puff with a flickering ember core reads as "fighting here"
    // without borrowing another symbol, and never draws a circle.
    let ph = input.age;                    // repeating 0..1 pulse phase
    let turb = turbulence(uv * 2.4 + input.seed * 30.0 + vec2f(0.0, -ph * 1.2));
    let puff = smoothstep(1.0, 0.05, length(uv * vec2f(1.0, 0.82)) + (turb - 0.5) * 0.7);
    let smoke = puff * (0.4 + 0.5 * turb);
    let ember = softDisc(uv * 3.4, 0.0) * (0.45 + 0.4 * sin(ph * 18.849 + input.seed * 9.0));
    rgb = mix(vec3f(0.11, 0.10, 0.10), vec3f(0.33, 0.31, 0.30), turb);
    rgb = mix(rgb, vec3f(1.0, 0.46, 0.15), clamp(ember, 0.0, 1.0));
    a = clamp(smoke * 0.72 + ember * 0.5, 0.0, 1.0);
  }

  if (kind == 4 || kind == 5 || kind == 6) {
    let frame=min(15.0,input.age*15.0);
    let bank=select(0.0,4.0,kind==6);
    let frameA=floor(frame);let frameB=min(15.0,frameA+1.0);
    let local=clamp(uv*.5+.5,vec2f(.002),vec2f(.998));
    let uvA=(vec2f(frameA%4.0,floor(frameA/4.0)+bank)+local)/vec2f(4.0,8.0);
    let uvB=(vec2f(frameB%4.0,floor(frameB/4.0)+bank)+local)/vec2f(4.0,8.0);
    let puff=mix(textureSampleLevel(effectAtlas,effectSampler,uvA,0.0),
                 textureSampleLevel(effectAtlas,effectSampler,uvB,0.0),fract(frame));
    a=puff.a*select(.62,.85,kind==6);
    rgb=select(puff.rgb*vec3f(.40,.39,.36),puff.rgb,kind==6);
    if(kind==4){rgb=puff.rgb*vec3f(.77,.66,.48);}
  }
  let out = clamp(a * input.alpha * (0.7 + 0.3 * input.intensity), 0.0, 1.0);
  if (out < 0.01) { discard; }
  return vec4f(rgb, out);
}
`;
