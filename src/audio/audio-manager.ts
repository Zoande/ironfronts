import {
  type AudioBus,
  type AudioPreferences,
  type AudioStorage,
  loadAudioPreferences,
  saveAudioPreferences,
  clampVolume,
} from './audio-preferences';

export type UiAudioCue = 'hover' | 'select' | 'dossier-open' | 'dossier-close' | 'confirm' | 'back';

type GainMap = Record<AudioBus, GainNode>;
type AudioContextConstructor = new () => AudioContext;
type AmbienceKey = 'rain' | 'wind' | 'ocean';

const UI_SAMPLE_URLS: Partial<Record<UiAudioCue, string>> = {
  'dossier-open': '/audio/sfx/dossier-open.wav',
  'dossier-close': '/audio/sfx/dossier-close.wav',
  back: '/audio/sfx/ui-switch.wav',
};

const AMBIENCE_CONFIG: Record<AmbienceKey, { url: string; volume: number; fadeSeconds: number }> = {
  rain: { url: '/audio/ambience/rain.ogg', volume: 0.48, fadeSeconds: 1.35 },
  wind: { url: '/audio/ambience/wind.ogg', volume: 0.15, fadeSeconds: 2.4 },
  ocean: { url: '/audio/ambience/ocean-waves.wav', volume: 0.32, fadeSeconds: 1.8 },
};

export interface MusicPlaybackOptions {
  loop?: boolean;
  fadeSeconds?: number;
  onEnded?: () => void;
}

interface MusicPlayback {
  element: HTMLAudioElement;
  source: MediaElementAudioSourceNode;
  gain: GainNode;
  url: string;
  cleanup?: () => void;
}

interface LoopingAmbience {
  source: AudioBufferSourceNode;
  gain: GainNode;
}

interface PreparedMusic {
  objectUrl?: string;
  discard: boolean;
  loading: Promise<void>;
}

export class AudioManager {
  private readonly storage?: AudioStorage;
  private preferences: AudioPreferences;
  private context?: AudioContext;
  private gains?: GainMap;
  private unlocked = false;
  private unlockInFlight?: Promise<boolean>;
  private currentMusic?: MusicPlayback;
  private musicRequest = 0;
  private readonly sampleBuffers = new Map<string, Promise<AudioBuffer | null>>();
  private readonly preparedMusic = new Map<string, PreparedMusic>();
  private readonly pendingUiCues = new Set<UiAudioCue>();
  private readonly uiCueTimes = new Map<UiAudioCue, number>();
  private readonly ambience = new Map<AmbienceKey, LoopingAmbience>();
  private readonly requestedAmbience = new Set<AmbienceKey>();
  private visibilityCleanup?: () => void;

  constructor(storage?: AudioStorage) {
    this.storage = storage;
    this.preferences = loadAudioPreferences(storage);
  }

  getVolume(bus: AudioBus): number {
    return this.preferences[bus];
  }

  isMusicPlaying(): boolean {
    // The <audio> element can report "not paused" while the Web Audio graph it
    // routes through is suspended (silent). Treat playback as real only when the
    // context is actually running.
    return Boolean(
      this.context?.state === 'running'
      && this.currentMusic
      && !this.currentMusic.element.paused,
    );
  }

  setVolume(bus: AudioBus, value: number): number {
    const volume = clampVolume(value);
    this.preferences = { ...this.preferences, [bus]: volume };
    saveAudioPreferences(this.storage, this.preferences);

    const gain = this.gains?.[bus];
    if (gain && this.context) {
      gain.gain.cancelScheduledValues(this.context.currentTime);
      gain.gain.setTargetAtTime(volume, this.context.currentTime, 0.025);
    }
    return volume;
  }

  async unlock(): Promise<boolean> {
    const context = this.ensureContext();
    if (!context) return false;

    // If the browser already resumed the context (its own autoplay unlock on a
    // real gesture, or a prior attempt that finally landed), reflect that now
    // and drop any stale in-flight attempt. A single early resume() that never
    // settles must not be able to poison every later caller.
    if (context.state === 'running') {
      this.unlocked = true;
      this.unlockInFlight = undefined;
      return true;
    }
    this.unlocked = false;
    if (this.unlockInFlight) return this.unlockInFlight;

    this.unlockInFlight = (async () => {
      try {
        if (context.state === 'suspended') {
          // Under the autoplay policy a resume() issued without an activation
          // can stay pending indefinitely. Bound it: whatever the outcome,
          // report the real context state and let the next gesture try again.
          await Promise.race([
            context.resume().catch(() => undefined),
            new Promise<void>((resolve) => { window.setTimeout(resolve, 2_000); }),
          ]);
        }
        this.unlocked = context.state === 'running';
        return this.unlocked;
      } catch {
        return false;
      } finally {
        this.unlockInFlight = undefined;
      }
    })();

    return this.unlockInFlight;
  }

  /**
   * Warm the first-interaction audio path while the menu is idle. Browsers
   * still require a user gesture before playback, but fetching/decoding can
   * happen beforehand so the first legitimate pointer/keyboard gesture does
   * not also pay the network/decode cost.
   */
  prime(musicUrls: readonly string[] = []): void {
    // Lobby music gets first claim on bandwidth.
    for (const url of musicUrls) this.prepareMusic(url);

    // Do not decode UI samples here: loadBuffer() calls ensureContext(), and we
    // want zero Web Audio work on the passive page-load path. UI cues are small
    // and decode lazily on the first activated click. (Adapted from PR #46.)
  }

  prepareMusic(url: string): void {
    if (!url || typeof fetch === 'undefined' || typeof URL === 'undefined' || this.preparedMusic.has(url)) return;

    // Do not use an <audio preload="auto"> element here. A media-element preload
    // can keep the browser tab's loading spinner alive and competes with the menu.
    // A background fetch warms the file without blocking document load; if it
    // finishes before the first click we play from an object URL immediately.
    const prepared: PreparedMusic = {
      discard: false,
      loading: Promise.resolve(),
    };
    prepared.loading = fetch(url, { cache: 'force-cache' })
      .then((response) => {
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        return response.blob();
      })
      .then((blob) => {
        const objectUrl = URL.createObjectURL(blob);
        if (prepared.discard) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        prepared.objectUrl = objectUrl;
      })
      .catch(() => {
        // Playback will fall back to normal streaming on the first interaction.
      });
    this.preparedMusic.set(url, prepared);
  }

  async playUiCue(cue: UiAudioCue): Promise<void> {
    // Do not poke the AudioContext on passive pointer movement before the
    // browser has granted audio. The first real click/key interaction owns
    // activation; hover sounds begin only after that.
    if (cue === 'hover' && !this.unlocked) return;

    const now = typeof performance === 'undefined' ? Date.now() : performance.now();
    const minimumGap = cue === 'hover' ? 70 : 28;
    if (now - (this.uiCueTimes.get(cue) ?? -Infinity) < minimumGap) return;
    if (this.pendingUiCues.has(cue)) return;

    this.uiCueTimes.set(cue, now);
    this.pendingUiCues.add(cue);

    try {
      if (!await this.unlock()) return;
      const uiGain = this.gains?.ui;
      if (!uiGain) return;

      const sample = UI_SAMPLE_URLS[cue];
      if (sample) {
        const sampled = await this.playSample(
          sample,
          uiGain,
          cue === 'hover' ? 0.34 : cue === 'confirm' ? 0.64 : 0.58,
        );
        if (sampled) {
          if (cue === 'confirm') {
            // A very small low-frequency thump underneath the mechanical sample
            // makes orders feel weightier without turning the UI into an arcade sound.
            this.playTone(uiGain, 128, 92, 0.10, 0.026, 'triangle');
          }
          return;
        }
      }

      // Asset loading failures degrade to generated cues rather than muting UI feedback.
      switch (cue) {
        case 'hover':
          // Keep routine menu navigation extremely cheap and low-pitched.
          // A single short oscillator avoids allocating a noise buffer for
          // every pointer movement.
          this.playTone(uiGain, 126, 104, 0.028, 0.014, 'triangle');
          break;
        case 'select':
          // Campaign selection: one low, dry mechanical thunk. No sampled
          // chirp and no per-click noise-buffer allocation.
          this.playTone(uiGain, 118, 76, 0.060, 0.040, 'triangle');
          break;
        case 'dossier-open':
          this.playNoise(uiGain, 0.16, 0.026, 850, 3600);
          this.playTone(uiGain, 155, 112, 0.10, 0.085, 'triangle');
          break;
        case 'dossier-close':
          this.playNoise(uiGain, 0.13, 0.022, 720, 2800);
          this.playTone(uiGain, 132, 178, 0.085, 0.070, 'triangle');
          break;
        case 'confirm':
          // Starting/resuming an operation: a deeper two-stage command thump.
          this.playTone(uiGain, 104, 68, 0.105, 0.050, 'triangle');
          this.playTone(uiGain, 82, 58, 0.085, 0.026, 'triangle', 0.035);
          break;
        case 'back':
          this.playTone(uiGain, 185, 145, 0.060, 0.050, 'triangle');
          break;
      }
    } catch (error) {
      // UI audio is non-critical. It must never be able to break or strand
      // menu interaction if a browser rejects a Web Audio operation.
      console.warn(`UI audio cue "${cue}" failed and was ignored.`, error);
    } finally {
      this.pendingUiCues.delete(cue);
    }
  }

  setRainEnabled(enabled: boolean): Promise<void> {
    return this.setAmbienceEnabled('rain', enabled);
  }

  setWindEnabled(enabled: boolean): Promise<void> {
    return this.setAmbienceEnabled('wind', enabled);
  }

  setOceanEnabled(enabled: boolean): Promise<void> {
    return this.setAmbienceEnabled('ocean', enabled);
  }

  async playThunder(): Promise<boolean> {
    if (!await this.unlock()) return false;
    const effectsGain = this.gains?.effects;
    if (!effectsGain) return false;

    // A first HRTF proof-of-concept: thunder is placed somewhere around the
    // listener so headphones receive a convincing direction cue. World-space
    // camera/listener synchronization can reuse the same path later.
    const angle = Math.random() * Math.PI * 2;
    const radius = 7 + Math.random() * 5;
    return this.playSpatialSample(
      '/audio/sfx/weather-thunder.ogg',
      effectsGain,
      0.78,
      [Math.cos(angle) * radius, 2.5 + Math.random() * 2.5, Math.sin(angle) * radius],
    );
  }

  /**
   * "One of your forces is under attack" cue. Routed through the `effects`
   * bus, so it obeys master + SFX volume but never the music volume, and can
   * never gate gameplay (a rejected AudioContext op is swallowed). The caller
   * owns dedupe / cooldown — this just plays the sample once.
   */
  async playCombatAlert(volume = 0.6): Promise<boolean> {
    try {
      if (!await this.unlock()) return false;
      const effectsGain = this.gains?.effects;
      if (!effectsGain) return false;
      return await this.playSample('/audio/sfx/alarmattackunit_1.ogg', effectsGain, volume);
    } catch (error) {
      console.warn('Combat alert cue failed and was ignored.', error);
      return false;
    }
  }

  async playMusic(url: string, options: MusicPlaybackOptions = {}): Promise<boolean> {
    if (!url || !await this.unlock()) return false;
    const request = ++this.musicRequest;
    const context = this.context;
    const musicGain = this.gains?.music;
    if (!context || !musicGain) return false;

    const fadeSeconds = Math.max(0.05, options.fadeSeconds ?? 1.2);
    const previous = this.currentMusic;

    const prepared = this.preparedMusic.get(url);
    this.preparedMusic.delete(url);

    let playbackUrl = url;
    let objectUrl: string | undefined;
    if (prepared?.objectUrl) {
      objectUrl = prepared.objectUrl;
      playbackUrl = objectUrl;
    } else if (prepared) {
      // Never wait for a preload on the user's first click. Start normal
      // streaming immediately and discard the background fetch when it lands.
      prepared.discard = true;
    }

    const element = new Audio();
    element.preload = 'auto';
    element.loop = options.loop ?? false;
    element.crossOrigin = 'anonymous';
    element.src = playbackUrl;

    const source = context.createMediaElementSource(element);
    const gain = context.createGain();
    gain.gain.value = 0;
    source.connect(gain);
    gain.connect(musicGain);

    const playback: MusicPlayback & { objectUrl?: string } = { element, source, gain, url, objectUrl };
    if (options.onEnded) {
      const onEnded = () => {
        if (this.currentMusic === playback) {
          this.currentMusic = undefined;
          options.onEnded?.();
        }
        this.destroyMusic(playback);
      };
      element.addEventListener('ended', onEnded, { once: true });
      playback.cleanup = () => element.removeEventListener('ended', onEnded);
    }

    try {
      await element.play();
    } catch {
      this.destroyMusic(playback);
      return false;
    }

    if (request !== this.musicRequest) {
      this.destroyMusic(playback);
      return false;
    }

    this.currentMusic = playback;
    const now = context.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + fadeSeconds);

    if (previous) {
      previous.gain.gain.cancelScheduledValues(now);
      previous.gain.gain.setValueAtTime(previous.gain.gain.value, now);
      previous.gain.gain.linearRampToValueAtTime(0, now + fadeSeconds);
      window.setTimeout(() => this.destroyMusic(previous), Math.ceil(fadeSeconds * 1000) + 80);
    }

    return true;
  }

  stopMusic(fadeSeconds = 0.8): void {
    this.musicRequest += 1;
    const playback = this.currentMusic;
    const context = this.context;
    if (!playback || !context) return;
    this.currentMusic = undefined;

    const fade = Math.max(0.03, fadeSeconds);
    const now = context.currentTime;
    playback.gain.gain.cancelScheduledValues(now);
    playback.gain.gain.setValueAtTime(playback.gain.gain.value, now);
    playback.gain.gain.linearRampToValueAtTime(0, now + fade);
    window.setTimeout(() => this.destroyMusic(playback), Math.ceil(fade * 1000) + 80);
  }

  installLifecycle(targetDocument: Document = document): void {
    this.visibilityCleanup?.();
    const onVisibilityChange = () => {
      const context = this.context;
      if (!context) return;
      // Deliberately do NOT suspend the context when the tab is hidden: the
      // soundtrack is meant to keep playing in a background tab. Only re-assert
      // a running context when the tab comes back (the OS/browser may have
      // suspended it under power-saving) and keep `unlocked` in step with the
      // real state.
      if (!targetDocument.hidden) {
        void context.resume()
          .then(() => { this.unlocked = context.state === 'running'; })
          .catch(() => undefined);
      }
    };
    targetDocument.addEventListener('visibilitychange', onVisibilityChange);
    this.visibilityCleanup = () => targetDocument.removeEventListener('visibilitychange', onVisibilityChange);
  }

  dispose(): void {
    this.musicRequest += 1;
    this.requestedAmbience.clear();
    this.visibilityCleanup?.();
    this.visibilityCleanup = undefined;

    if (this.currentMusic) this.destroyMusic(this.currentMusic);
    this.currentMusic = undefined;

    for (const active of this.ambience.values()) {
      try {
        active.source.stop();
      } catch {
        // Source may already have stopped.
      }
      active.source.disconnect();
      active.gain.disconnect();
    }
    this.ambience.clear();

    const context = this.context;
    for (const prepared of this.preparedMusic.values()) {
      prepared.discard = true;
      if (prepared.objectUrl) URL.revokeObjectURL(prepared.objectUrl);
    }
    this.preparedMusic.clear();
    this.pendingUiCues.clear();
    this.uiCueTimes.clear();

    this.context = undefined;
    this.gains = undefined;
    this.sampleBuffers.clear();
    this.unlockInFlight = undefined;
    this.unlocked = false;
    if (context && context.state !== 'closed') void context.close().catch(() => undefined);
  }

  private ensureContext(): AudioContext | undefined {
    if (this.context) return this.context;
    if (typeof window === 'undefined') return undefined;

    const webkitWindow = window as typeof window & { webkitAudioContext?: AudioContextConstructor };
    const Context = window.AudioContext ?? webkitWindow.webkitAudioContext;
    if (!Context) return undefined;

    const context = new Context();
    const master = context.createGain();
    const music = context.createGain();
    const ui = context.createGain();
    const ambience = context.createGain();
    const effects = context.createGain();

    master.gain.value = this.preferences.master;
    music.gain.value = this.preferences.music;
    ui.gain.value = this.preferences.ui;
    ambience.gain.value = this.preferences.ambience;
    effects.gain.value = this.preferences.effects;

    music.connect(master);
    ui.connect(master);
    ambience.connect(master);
    effects.connect(master);
    master.connect(context.destination);

    this.context = context;
    this.gains = { master, music, ui, ambience, effects };
    return context;
  }

  private async setAmbienceEnabled(key: AmbienceKey, enabled: boolean): Promise<void> {
    if (!enabled) {
      this.requestedAmbience.delete(key);
      this.fadeOutAmbience(key);
      return;
    }

    this.requestedAmbience.add(key);
    if (this.ambience.has(key) || !await this.unlock()) return;

    const context = this.context;
    const ambienceGain = this.gains?.ambience;
    const config = AMBIENCE_CONFIG[key];
    if (!context || !ambienceGain) return;

    const buffer = await this.loadBuffer(config.url);
    if (!buffer || !this.requestedAmbience.has(key) || this.ambience.has(key)) return;

    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    source.loop = true;
    source.connect(gain);
    gain.connect(ambienceGain);

    const now = context.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(config.volume, now + config.fadeSeconds);
    source.start();
    this.ambience.set(key, { source, gain });
  }

  private fadeOutAmbience(key: AmbienceKey): void {
    const active = this.ambience.get(key);
    const context = this.context;
    if (!active || !context) return;
    this.ambience.delete(key);

    const fadeSeconds = Math.min(1.2, AMBIENCE_CONFIG[key].fadeSeconds);
    const now = context.currentTime;
    active.gain.gain.cancelScheduledValues(now);
    active.gain.gain.setValueAtTime(Math.max(0.0001, active.gain.gain.value), now);
    active.gain.gain.exponentialRampToValueAtTime(0.0001, now + fadeSeconds);
    window.setTimeout(() => {
      try {
        active.source.stop();
      } catch {
        // Source may already have stopped during teardown.
      }
      active.source.disconnect();
      active.gain.disconnect();
    }, Math.ceil(fadeSeconds * 1000) + 60);
  }

  private async playSample(url: string, destination: AudioNode, volume: number): Promise<boolean> {
    const context = this.context;
    if (!context) return false;
    const buffer = await this.loadBuffer(url);
    if (!buffer || !this.unlocked) return false;

    const source = context.createBufferSource();
    const gain = context.createGain();
    gain.gain.value = Math.max(0, volume);
    source.buffer = buffer;
    source.connect(gain);
    gain.connect(destination);
    source.addEventListener('ended', () => {
      source.disconnect();
      gain.disconnect();
    }, { once: true });
    source.start();
    return true;
  }

  private async playSpatialSample(
    url: string,
    destination: AudioNode,
    volume: number,
    position: readonly [number, number, number],
  ): Promise<boolean> {
    const context = this.context;
    if (!context) return false;
    const buffer = await this.loadBuffer(url);
    if (!buffer || !this.unlocked) return false;

    const source = context.createBufferSource();
    const gain = context.createGain();
    const panner = context.createPanner();
    gain.gain.value = Math.max(0, volume);
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 2;
    panner.maxDistance = 40;
    panner.rolloffFactor = 0.55;
    panner.positionX.value = position[0];
    panner.positionY.value = position[1];
    panner.positionZ.value = position[2];

    source.buffer = buffer;
    source.connect(gain);
    gain.connect(panner);
    panner.connect(destination);
    source.addEventListener('ended', () => {
      source.disconnect();
      gain.disconnect();
      panner.disconnect();
    }, { once: true });
    source.start();
    return true;
  }

  private loadBuffer(url: string): Promise<AudioBuffer | null> {
    const cached = this.sampleBuffers.get(url);
    if (cached) return cached;

    const context = this.ensureContext();
    if (!context) return Promise.resolve(null);
    const loading = fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        return response.arrayBuffer();
      })
      .then((bytes) => context.decodeAudioData(bytes))
      .catch((error) => {
        console.warn(`Unable to load audio asset ${url}`, error);
        this.sampleBuffers.delete(url);
        return null;
      });
    this.sampleBuffers.set(url, loading);
    return loading;
  }

  private playTone(
    destination: AudioNode,
    startFrequency: number,
    endFrequency: number,
    duration: number,
    peak: number,
    type: OscillatorType,
    delay = 0,
  ): void {
    const context = this.context;
    if (!context) return;

    const start = context.currentTime + delay;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(startFrequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency), start + duration);

    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), start + Math.min(0.012, duration * 0.25));
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    oscillator.connect(envelope);
    envelope.connect(destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.01);
  }

  private playNoise(
    destination: AudioNode,
    duration: number,
    peak: number,
    lowFrequency: number,
    highFrequency: number,
  ): void {
    const context = this.context;
    if (!context) return;

    const frameCount = Math.max(1, Math.floor(context.sampleRate * duration));
    const buffer = context.createBuffer(1, frameCount, context.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let index = 0; index < samples.length; index += 1) {
      const fade = 1 - index / samples.length;
      samples[index] = (Math.random() * 2 - 1) * fade;
    }

    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const envelope = context.createGain();
    filter.type = 'bandpass';
    filter.frequency.value = (lowFrequency + highFrequency) * 0.5;
    filter.Q.value = Math.max(0.2, filter.frequency.value / Math.max(1, highFrequency - lowFrequency));

    const now = context.currentTime;
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), now + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    source.buffer = buffer;
    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(destination);
    source.start(now);
    source.stop(now + duration + 0.01);
  }

  private destroyMusic(playback: MusicPlayback & { objectUrl?: string }): void {
    playback.cleanup?.();
    playback.cleanup = undefined;
    playback.element.pause();
    playback.element.removeAttribute('src');
    playback.element.load();
    if (playback.objectUrl) {
      URL.revokeObjectURL(playback.objectUrl);
      playback.objectUrl = undefined;
    }
    try {
      playback.source.disconnect();
      playback.gain.disconnect();
    } catch {
      // Nodes may already be disconnected during page teardown.
    }
  }
}
