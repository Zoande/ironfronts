import { vec3 } from 'gl-matrix';
import { StrategyCamera } from './camera';
import { buildPropVisibility, buildTerrainVisibility, capVisibleInstances } from './chunk-visibility';
import {
  DEFAULT_QUALITY, QUALITY_LEVELS, QUALITY_PRESETS, resolveRenderPixelRatio,
  type QualityLevel, type QualityPreset,
} from './graphics/quality';
import { buildCountryColorBuffer, CountryLabelLayer } from './country-overlay';
import { loadCountryLabelFont } from './country-labels/atlas';
import { isValidCountryLabelPoint } from './country-labels/territory';
import { buildDiplomacyColorData, findCountryByName } from './diplomacy';
import { EnvironmentController, type TimeOfDayState } from './environment-controller';
import { FRAME_UNIFORM_BYTES, packFrameUniforms } from './frame-uniforms';
import { align4, fetchBinary, fetchJson, uploadMipmappedTexture, uploadTexture } from './gpu-utils';
import { createMaterialTexture, createTreeMaterialTexture } from './material-texture';
import {
  createEmptyRenderWorkload, PerformanceMonitor,
  type PerformancePhases, type PerformanceSnapshot, type RenderCategory,
} from './performance-monitor';
import { createHoverInfo, pickTerrainPoint, resolvePrimaryClick } from './picking';
import { PoliticalCache } from './political-cache';
import {
  aggregateProvinceResources, generateResourceNodes, type ProvinceResources, type ResourceNode,
} from './resource-nodes';
import { createRendererLayouts, createRendererPipelines } from './renderer-pipelines';
import { beginWorldFrame, submitWorldFrame } from './renderer-frame';
import type { InstanceLayer, PerformanceLayerVisibility } from './renderer-types';
import { COUNTRY_LABEL_FADE_END_ALTITUDE } from './shaders/country-labels';
import {
  createBarrierMesh, createBuildingArchetypeMesh, createLampMesh, createSignMesh, createTerrainMesh,
  createTreeFamilyMesh, uploadIndexedMesh,
} from './scene-meshes';
import type { Mesh } from './scene-meshes';
import type {
  CountryRecord, DiplomacyState, DiplomaticRelation, FrameStats, HoverInfo, ProgressReporter, PropChunkRange,
  ProvinceRecord, WorldManifest,
} from './types';
import {
  extractFrustumPlanes, sphereIntersectsFrustum, sphereIntersectsHorizontalWorldWindow, WORLD_COPY_INDICES,
} from './visibility';
import { sampleWrappedField } from './world-sampling';
import { loadWorldAssetBuffers, worldAssetUrl } from './world-assets';
import { getVisibleInstanceView, updateVisibleInstanceView } from './visible-instance-cache';

const LABELS_ABOVE_PROPS_DISTANCE = 2_500;

/** Player-start camera: north-up, near top-down (~83°; a true 90° breaks picking). */
const PLAYER_START_YAW = 0;
const PLAYER_START_PITCH = 1.45;
// Strategic markers are a regional / close-zoom aid; above this orbit distance
// the overview map stays clean and the marker draw is skipped entirely.
const MAP_MARKER_MAX_DISTANCE = 5_000;
const MIN_RAIN_PARTICLES = 400;
const MAX_RAIN_PARTICLES = 1_400;

export type MapMode = 'political' | 'diplomacy' | 'clear' | 'balanced';

export type { TimeOfDayState } from './environment-controller';

export class WorldRenderer {
  readonly camera = new StrategyCamera();

  manifest!: WorldManifest;
  onHover?: (info: HoverInfo | null, x: number, y: number) => void;
  onStats?: (stats: FrameStats) => void;
  onDiplomacyChange?: (state: DiplomacyState) => void;
  onProvinceSelected?: (info: HoverInfo | null) => void;
  /** Gameplay-layer map tap handler. Return true to consume the click
   *  (army selection / move order) and suppress province selection. */
  onMapClick?: (clientX: number, clientY: number) => boolean;
  /** Right-click / secondary tap: issue a move/attack order for the selected army. */
  onMapCommand?: (clientX: number, clientY: number) => boolean;
  onTimeOfDayChange?: (state: TimeOfDayState) => void;

  private readonly canvas: HTMLCanvasElement;
  private readonly countryLabelCanvas?: HTMLCanvasElement;
  private adapter!: GPUAdapter;
  private device!: GPUDevice;
  private deviceReady = false;
  private context!: GPUCanvasContext;
  private contextConfigured = false;
  private format!: GPUTextureFormat;
  private depthTexture?: GPUTexture;
  private commonLayout!: GPUBindGroupLayout;
  private instanceLayout!: GPUBindGroupLayout;
  private lineLayout!: GPUBindGroupLayout;
  private countryLabelLayout!: GPUBindGroupLayout;
  private commonBindGroup!: GPUBindGroup;
  private uniformBuffer!: GPUBuffer;
  private terrainPipeline!: GPURenderPipeline;
  private polarCapPipeline!: GPURenderPipeline;
  private waterPipeline!: GPURenderPipeline;
  private waterwayPipeline!: GPURenderPipeline;
  private infrastructurePipeline!: GPURenderPipeline;
  private propPipeline!: GPURenderPipeline;
  private cityLightPipeline!: GPURenderPipeline;
  private rainPipeline!: GPURenderPipeline;
  private linePipeline!: GPURenderPipeline;
  private mapMarkerPipeline!: GPURenderPipeline;
  private armyMarkerPipeline!: GPURenderPipeline;
  private armyCompositionPipeline!: GPURenderPipeline;
  private armyModelPipeline!: GPURenderPipeline;
  private combatEffectPipeline!: GPURenderPipeline;
  private countryLabelPipeline!: GPURenderPipeline;
  private countryLabelBuffer?: GPUBuffer;
  private countryLabelParamsBuffer?: GPUBuffer;
  private countryLabelBindGroup?: GPUBindGroup;
  private lastCountryLabelRevision = -1;
  private terrainMeshes!: Mesh[];
  private polarCapMesh!: Mesh;
  private waterMeshes!: Mesh[];
  private roadMesh!: Mesh;
  private hiddenConnectionMesh!: Mesh;
  private waterwayMesh!: Mesh;
  private treeMeshes!: Mesh[][];
  private buildingMeshes!: Mesh[][];
  private lampMesh!: Mesh;
  private barrierMesh!: Mesh;
  private signMesh!: Mesh;
  private trees!: InstanceLayer;
  private buildings!: InstanceLayer;
  private lamps!: InstanceLayer;
  private barriers!: InstanceLayer;
  private signs!: InstanceLayer;
  private borders!: InstanceLayer;
  private connections?: InstanceLayer;
  private waterwayNetwork?: InstanceLayer;
  private heightTexture!: GPUTexture;
  private surfaceTexture!: GPUTexture;
  private terrainAlbedoTexture!: GPUTexture;
  private provinceTexture!: GPUTexture;
  private coastTexture!: GPUTexture;
  private navigationTexture!: GPUTexture;
  private terrainNormalTexture!: GPUTexture;
  private materialTexture!: GPUTexture;
  private treeMaterialTexture!: GPUTexture;
  private provincePoliticalColorTexture!: GPUTexture;
  private diplomacyColorTexture!: GPUTexture;
  private politicalCache!: PoliticalCache;
  private countryColors!: Float32Array;
  private visibleTerrainBuffer!: GPUBuffer;
  private terrainLodDraws: Array<{ firstInstance: number; instanceCount: number; lod: number }> = [];
  private lastTerrainVisibilityRevision = -1;
  private readonly frustumPlanes = new Float32Array(24);
  private frustumPlanesRevision = -1;
  private heightData!: Float32Array;
  private provinceData!: Uint16Array;
  private resourceNodeList: readonly ResourceNode[] = [];
  private provinceResources = new Map<number, ProvinceResources>();
  /** Static settlement markers: road junctions + unnamed towns only (no
   *  deposits — those live in `gameResourceMarkers`). Drawn at map zoom
   *  regardless of the resource-overlay toggle. */
  private mapMarkers?: InstanceLayer;
  private showResourceOverlay = false;
  /** Dynamic army-stack markers. Fixed capacity; only the used prefix is
   *  drawn. Rewritten from authoritative GameState when the army set changes. */
  private armyMarkers?: InstanceLayer;
  private armyModels?: InstanceLayer;
  private static readonly ARMY_MARKER_CAPACITY = 1_024;
  private static readonly ARMY_MODEL_CAPACITY = 4_096;
  private static readonly ARMY_MODEL_VERTEX_COUNT = 6 * 36;
  /** Base camera distance for the strategic-marker <-> 3D-model LOD swap. */
  private static readonly ARMY_MODEL_RANGE_BASE = 1_900;
  /** The ONLY resource-deposit marker layer: fed the player-visible authoritative
   *  set (natural + scenario-guaranteed, fog-filtered) via `setGameResourceMarkers`.
   *  The static `mapMarkers` layer carries junctions/towns only. */
  private gameResourceMarkers?: InstanceLayer;
  private static readonly RESOURCE_MARKER_CAPACITY = 4_096;
  /** Pooled world-space combat effects (see CombatEffectPool). 8 floats each. */
  private combatEffects?: InstanceLayer;
  private static readonly COMBAT_EFFECT_CAPACITY = 384;
  private static readonly COMBAT_EFFECT_MAX_DISTANCE = 5_000;
  /** Own-army movement/attack routes (line mode 3), one LineRecord per segment. */
  private routeLines?: InstanceLayer;
  private static readonly ROUTE_SEGMENT_CAPACITY = 4_096;
  private static readonly ROUTE_MAX_DISTANCE = 6_400;
  /** Flat (ax, az, bx, bz) edges of the movement/road graph — junction input. */
  private connectionGraph?: Float32Array;
  /** World-space centres of the more populous provinces (junction spacing). */
  private settlementCenters: Array<readonly [number, number]> = [];
  private waterwayMask!: Uint8Array;
  private provinceOwners!: Uint32Array;
  private provinceById = new Map<number, ProvinceRecord>();
  private countryById = new Map<number, CountryRecord>();
  private playerCountryId = 0;
  private readonly diplomaticRelations = new Map<number, DiplomaticRelation>();
  private countryLabels?: CountryLabelLayer;
  private running = false;
  private initialized = false;
  private disposed = false;
  private runtimeBindingsAttached = false;
  private interactionAbort?: AbortController;
  private frameHandle = 0;
  private previousTime = performance.now();
  private elapsed = 0;
  /** While the tab is hidden the rAF loop keeps ticking (to resume instantly)
   *  but does no GPU/pick/uniform work — the WS session and audio are elsewhere
   *  and keep running. */
  private renderingSuspended = typeof document !== 'undefined' && document.hidden;
  private quality: QualityLevel = DEFAULT_QUALITY;
  private readonly environment = new EnvironmentController();
  private reportedClock = '';
  private performanceMonitor = new PerformanceMonitor(false);
  private frameWorkload = createEmptyRenderWorkload();
  private statsFrameCountdown = 0;
  private gpuQuerySet?: GPUQuerySet;
  private gpuResolveBuffer?: GPUBuffer;
  private gpuReadBuffer?: GPUBuffer;
  private gpuReadPending = false;
  private gpuQueryCountdown = 0;
  private performanceEpoch = 0;
  private debugView = 0;
  private showWireframe = false;
  private showConnections = false;
  private showWaterwayNetwork = false;
  private showBorders = true;
  private showCountryOverlay = true;
  private mapMode: MapMode = 'political';
  private showProps = true;
  private showRoads = true;
  private showHiddenConnections = true;
  private showWaterways = true;
  private performanceLayers: PerformanceLayerVisibility = {
    terrain: true,
    ocean: true,
    trees: true,
    buildings: true,
    roadFurniture: true,
    countryTint: true,
    countryBorders: true,
    countryLabels: true,
  };
  private pointer = { x: 0, y: 0, inside: false };
  private hoveredId = 0;
  private selectedId = 0;
  private pickingDirty = false;
  private lastPickedCameraRevision = -1;
  private lastPickTime = -Infinity;
  private readonly pickPoint = vec3.create();
  private clickStart?: { pointerId: number; x: number; y: number };
  private resizeObserver?: ResizeObserver;
  private readonly onUncapturedError = (event: GPUUncapturedErrorEvent): void => {
    const message = event.error instanceof GPUValidationError ? event.error.message : String(event.error);
    console.error(`WebGPU validation error: ${message}`);
  };

  constructor(
    canvas: HTMLCanvasElement,
    countryLabelCanvas?: HTMLCanvasElement,
    quality: QualityLevel = DEFAULT_QUALITY,
  ) {
    this.canvas = canvas;
    this.countryLabelCanvas = countryLabelCanvas;
    this.quality = QUALITY_PRESETS[quality] ? quality : DEFAULT_QUALITY;
  }

  private get qualityPreset(): QualityPreset {
    return QUALITY_PRESETS[this.quality];
  }

  /** Current graphics preset id. */
  get graphicsQuality(): QualityLevel {
    return this.quality;
  }

  /** Backing-store scale actually in use (× CSS pixels). */
  get effectiveRenderScale(): number {
    return resolveRenderPixelRatio(this.quality);
  }

  /**
   * Camera distance below which close 3D army models draw (above it, only the
   * strategic markers). Scaled by the preset prop-distance knob so LOW drops to
   * markers sooner and ULTRA holds the models further out. Floored so LOW still
   * shows models when the camera is genuinely low.
   */
  private get armyModelDrawDistance(): number {
    return Math.max(900, WorldRenderer.ARMY_MODEL_RANGE_BASE * this.qualityPreset.propDistanceScale);
  }

  /**
   * Resolved preset knobs + the live counts they gate, for the graphics dev
   * readout. Lets QA prove a preset switch actually changed the renderer.
   */
  get qualityReadout(): {
    propDistanceScale: number; terrainLodScale: number; detailFactor: number;
    treeBudget: number; buildingBudget: number; furniture: boolean;
    armyModelRange: number; armyModelCount: number;
  } {
    const p = this.qualityPreset;
    return {
      propDistanceScale: p.propDistanceScale,
      terrainLodScale: p.terrainLodScale,
      detailFactor: p.detailFactor,
      treeBudget: p.treeInstanceBudget,
      buildingBudget: p.buildingInstanceBudget,
      furniture: p.furniture,
      armyModelRange: Math.round(this.armyModelDrawDistance),
      armyModelCount: this.armyModels?.count ?? 0,
    };
  }

  /** Deterministic visual resource-deposit layer (no economy wiring). */
  get resourceNodes(): readonly ResourceNode[] {
    return this.resourceNodeList;
  }

  /**
   * Read-only world facts the authoritative game layer needs. The renderer is a
   * data source here, not the game authority — `main.ts` adapts these into a
   * `WorldData` for `GameSession`. `connectionGraph` is undefined only if its
   * fetch failed (junction markers off).
   */
  get worldWidth(): number { return this.manifest.world.width; }
  get worldHeight(): number { return this.manifest.world.height; }
  get provinceIdRaster(): Uint16Array { return this.provinceData; }
  get provinceIdField(): { width: number; height: number } {
    return {
      width: this.manifest.fields.provinceIds.width,
      height: this.manifest.fields.provinceIds.height,
    };
  }
  get surfaceFieldSize(): { width: number; height: number } {
    return {
      width: this.manifest.fields.surface.width,
      height: this.manifest.fields.surface.height,
    };
  }
  get worldConnectionGraph(): Float32Array | undefined { return this.connectionGraph; }

  /**
   * Show / hide the GPU resource-deposit overlay. Cheap boolean flip — the
   * markers are already resident on the GPU; this only gates that one instanced
   * draw. Junction / town (settlement) markers are independent and stay on.
   */
  setResourceOverlay(enabled: boolean): void {
    this.showResourceOverlay = enabled;
  }

  /**
   * Precomputed deposit quantities for a province (abstract strategic units,
   * not production/day). Returns null when the province holds no known
   * deposits. O(1) map lookup — no node scan.
   */
  getProvinceResources(provinceId: number): ProvinceResources | null {
    return this.provinceResources.get(provinceId) ?? null;
  }

  /**
   * Switch graphics preset at runtime. Triggers one safe resize /
   * swap-chain + depth reconfigure and invalidates the visible-instance
   * caches so the new draw distances and budgets take effect next frame.
   * No GPU pipelines or world buffers are recreated.
   */
  setQuality(level: QualityLevel): void {
    if (!QUALITY_PRESETS[level] || level === this.quality) return;
    this.quality = level;
    if (this.deviceReady) {
      this.resize();
      this.camera.revision += 1;
      this.lastTerrainVisibilityRevision = -1;
      this.performanceMonitor.reset();
    }
  }

  async initialize(report: ProgressReporter): Promise<void> {
    if (this.disposed) throw new Error('Cannot initialize a disposed renderer');
    if (this.initialized) return;
    if (!navigator.gpu) throw new Error('WebGPU is unavailable');
    report('Loading world manifest', 0.04);
    this.manifest = await fetchJson<WorldManifest>(worldAssetUrl('world.json'));
    this.provinceById = new Map(this.manifest.provinces.map((province) => [province.id, province]));
    this.countryById = new Map(this.manifest.politics.countries.map((country) => [country.id, country]));
    if (this.manifest.politics.countries.some((country) => country.id > 255)) {
      throw new Error('Diplomacy rendering supports country ids up to 255');
    }
    const defaultPlayer = findCountryByName(this.manifest.politics.countries, 'Spain')
      ?? this.manifest.politics.countries[0];
    if (!defaultPlayer) throw new Error('The world has no countries');
    this.playerCountryId = defaultPlayer.id;
    this.camera.configureWorld(this.manifest.world.width, this.manifest.world.height);
    this.camera.minimumAltitude = this.manifest.terrain.maxHeight + 82;

    report('Requesting WebGPU device', 0.1);
    this.adapter = (await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
      ?? await navigator.gpu.requestAdapter()
      ?? await navigator.gpu.requestAdapter({ forceFallbackAdapter: true })) as GPUAdapter;
    if (!this.adapter) throw new Error('No compatible WebGPU adapter was found');
    const gpuTimingSupported = this.adapter.features.has('timestamp-query');
    this.device = await this.adapter.requestDevice({
      requiredFeatures: gpuTimingSupported ? ['timestamp-query'] : [],
    });
    this.deviceReady = true;
    this.performanceMonitor = new PerformanceMonitor(gpuTimingSupported);
    if (gpuTimingSupported) {
      this.gpuQuerySet = this.device.createQuerySet({ type: 'timestamp', count: 2 });
      this.gpuResolveBuffer = this.device.createBuffer({
        label: 'GPU frame timestamp resolve',
        size: 16,
        usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
      });
      this.gpuReadBuffer = this.device.createBuffer({
        label: 'GPU frame timestamp readback',
        size: 16,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
    }
    this.device.lost.then((info) => {
      if (this.disposed) return;
      console.error('WebGPU device lost', info);
      if (this.running) window.location.reload();
    });
    this.device.addEventListener('uncapturederror', this.onUncapturedError);

    this.context = this.canvas.getContext('webgpu') as GPUCanvasContext;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.createLayouts();

    report('Loading terrain fields', 0.2);
    const {
      heightBuffer, surfaceBuffer, terrainNormalBuffer, terrainAlbedoBuffer, navigationBuffer, coastBuffer,
      provinceBuffer, roadVertexBuffer, roadIndexBuffer, hiddenConnectionVertexBuffer, hiddenConnectionIndexBuffer,
      waterwayVertexBuffer, waterwayIndexBuffer, borderBuffer, treeBuffer, buildingBuffer, lampBuffer,
      barrierBuffer, signBuffer, provinceOwnerData, provinceAdjacencyData, provinceLabelData,
    } = await loadWorldAssetBuffers(this.manifest);
    this.heightData = new Float32Array(heightBuffer);
    this.provinceData = new Uint16Array(provinceBuffer);
    this.resourceNodeList = generateResourceNodes({
      surface: new Uint8Array(surfaceBuffer),
      surfaceField: this.manifest.fields.surface,
      height: this.heightData,
      heightField: this.manifest.fields.height,
      world: this.manifest.world,
    });
    this.provinceResources = aggregateProvinceResources(
      this.resourceNodeList,
      (x, z) => {
        const encoded = this.sampleProvince(x, z);
        return encoded ? encoded - 1 : 0;
      },
    );
    try {
      const graph = await fetchBinary(worldAssetUrl(this.manifest.buffers.connections.url));
      this.connectionGraph = new Float32Array(graph);
      const details = await fetchJson<{ provinces: Array<{ center: [number, number]; population: number }> }>(
        worldAssetUrl(this.manifest.sidecars.provinceDetails.url),
      );
      // The 250 most populous provinces stand in for "real cities" — junction
      // markers keep clear of these so they never crowd a labelled settlement.
      this.settlementCenters = details.provinces
        .slice()
        .sort((a, b) => b.population - a.population)
        .slice(0, 250)
        .map((province) => province.center);
    } catch {
      this.connectionGraph = undefined; // road-junction markers simply stay off
      this.settlementCenters = [];
    }
    this.waterwayMask = buildWaterwayMask(new Uint8Array(navigationBuffer), this.provinceData.length);
    this.provinceOwners = new Uint32Array(provinceOwnerData);
    this.countryColors = buildCountryColorBuffer(this.manifest.politics.countries);
    this.politicalCache = new PoliticalCache(
      this.manifest,
      this.provinceData,
      this.provinceOwners,
      this.countryColors,
      borderBuffer,
    );

    report('Uploading terrain fields', 0.37);
    this.heightTexture = uploadTexture(this.device,
      'terrain height', this.manifest.fields.height.width, this.manifest.fields.height.height,
      'r32float', new Uint8Array(heightBuffer), this.manifest.fields.height.width * 4,
    );
    this.surfaceTexture = uploadTexture(this.device,
      'terrain surface', this.manifest.fields.surface.width, this.manifest.fields.surface.height,
      'rgba8uint', new Uint8Array(surfaceBuffer), this.manifest.fields.surface.width * 4,
    );
    this.terrainNormalTexture = uploadTexture(this.device,
      'precomputed terrain normals', this.manifest.fields.terrainNormal.width, this.manifest.fields.terrainNormal.height,
      'rg8snorm', new Uint8Array(terrainNormalBuffer), this.manifest.fields.terrainNormal.width * 2,
    );
    this.terrainAlbedoTexture = uploadMipmappedTexture(this.device,
      'baked terrain albedo and occlusion', this.manifest.fields.terrainAlbedo, new Uint8Array(terrainAlbedoBuffer),
    );
    this.navigationTexture = uploadTexture(this.device,
      'packed roads and waterways', this.manifest.fields.navigation.width, this.manifest.fields.navigation.height,
      'rgba8unorm', new Uint8Array(navigationBuffer), this.manifest.fields.navigation.width * 4,
    );
    this.coastTexture = uploadTexture(this.device,
      'signed-distance bank field', this.manifest.fields.coast.width, this.manifest.fields.coast.height,
      'rg8unorm', new Uint8Array(coastBuffer), this.manifest.fields.coast.width * 2,
    );
    this.provinceTexture = uploadTexture(this.device,
      'province ids', this.manifest.fields.provinceIds.width, this.manifest.fields.provinceIds.height,
      'r16uint', new Uint8Array(provinceBuffer), this.manifest.fields.provinceIds.width * 2,
    );
    this.provincePoliticalColorTexture = uploadTexture(this.device,
      'province political colors', this.politicalCache.width, this.politicalCache.height,
      'rgba8unorm', this.politicalCache.colors, this.politicalCache.width * 4,
    );
    const diplomacyColors = buildDiplomacyColorData(
      this.manifest.politics.countries,
      this.diplomaticRelations,
      this.playerCountryId,
    );
    this.diplomacyColorTexture = uploadTexture(this.device,
      'diplomacy country colors', diplomacyColors.length / 4, 1,
      'rgba8unorm', diplomacyColors, diplomacyColors.length,
    );

    report('Preparing terrain and tree materials', 0.49);
    [this.materialTexture, this.treeMaterialTexture] = await Promise.all([
      createMaterialTexture(this.device),
      createTreeMaterialTexture(this.device),
    ]);
    this.uniformBuffer = this.device.createBuffer({
      label: 'frame uniforms',
      size: FRAME_UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.visibleTerrainBuffer = this.device.createBuffer({
      label: 'visible terrain chunks',
      size: this.manifest.terrain.chunksX * this.manifest.terrain.chunksY * 3 * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.commonBindGroup = this.device.createBindGroup({
      label: 'world resources',
      layout: this.commonLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: this.heightTexture.createView() },
        { binding: 2, resource: this.surfaceTexture.createView() },
        { binding: 3, resource: this.provinceTexture.createView() },
        { binding: 4, resource: this.materialTexture.createView({ dimension: '2d-array' }) },
        { binding: 5, resource: this.device.createSampler({ addressModeU: 'repeat', addressModeV: 'repeat', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear' }) },
        { binding: 6, resource: this.coastTexture.createView() },
        { binding: 7, resource: this.navigationTexture.createView() },
        { binding: 8, resource: this.terrainNormalTexture.createView() },
        { binding: 9, resource: this.treeMaterialTexture.createView({ dimension: '2d-array' }) },
        { binding: 10, resource: this.provincePoliticalColorTexture.createView() },
        { binding: 11, resource: this.diplomacyColorTexture.createView() },
        { binding: 12, resource: { buffer: this.visibleTerrainBuffer } },
        { binding: 13, resource: this.terrainAlbedoTexture.createView() },
      ],
    });

    report('Compiling WebGPU pipelines', 0.62);
    this.createPipelines();
    this.terrainMeshes = [this.manifest.terrain.gridResolution, 33, 17, 9]
      .map((resolution) => createTerrainMesh(this.device, resolution, true));
    this.polarCapMesh = createTerrainMesh(this.device, 65);
    // Water MUST tessellate identically to terrain at every LOD. Both passes
    // key off the same per-chunk `draw.lod` and decide coast coverage from
    // landAt(interpolated mapUv); when the water grid was coarser (was
    // [33,25,17,9] vs terrain's [49,33,17,9]) the 0.5 coast contour landed on a
    // different polyline in each pass, so at a fine LOD (Ultra) a shoreline
    // fragment could be discarded by BOTH — the black rectangles. Matching the
    // resolutions makes landAt(mapUv) per-pixel identical, so the
    // terrain `<= 0.5` / water `> 0.5` split covers every fragment exactly once.
    this.waterMeshes = [this.manifest.terrain.gridResolution, 33, 17, 9]
      .map((resolution) => createTerrainMesh(this.device, resolution));
    this.roadMesh = uploadIndexedMesh(this.device, 'terrain roads', roadVertexBuffer, roadIndexBuffer, this.manifest.buffers.roadIndices.count);
    this.hiddenConnectionMesh = uploadIndexedMesh(this.device, 'floating hidden connections', hiddenConnectionVertexBuffer,
      hiddenConnectionIndexBuffer, this.manifest.buffers.hiddenConnectionIndices.count);
    this.waterwayMesh = uploadIndexedMesh(this.device, 'supplied rivers and canals', waterwayVertexBuffer,
      waterwayIndexBuffer, this.manifest.buffers.waterwayIndices.count);
    this.treeMeshes = (['broadleaf', 'conifer'] as const).map((family) =>
      [0, 1, 2].map((lod) => createTreeFamilyMesh(this.device, family, lod as 0 | 1 | 2)));
    this.buildingMeshes = Array.from({ length: 5 }, (_, archetype) =>
      [0, 1].map((lod) => createBuildingArchetypeMesh(this.device, archetype, lod as 0 | 1)));
    this.lampMesh = createLampMesh(this.device);
    this.barrierMesh = createBarrierMesh(this.device);
    this.signMesh = createSignMesh(this.device);

    report('Uploading world geometry', 0.78);
    this.trees = this.createInstanceLayer('trees', treeBuffer, this.manifest.buffers.trees.count, 0, this.instanceLayout, true);
    this.buildings = this.createInstanceLayer('buildings', buildingBuffer, this.manifest.buffers.buildings.count, 1, this.instanceLayout, true);
    this.lamps = this.createInstanceLayer('road lamps', lampBuffer, this.manifest.buffers.lamps.count, 2, this.instanceLayout, true);
    this.barriers = this.createInstanceLayer('road barriers', barrierBuffer, this.manifest.buffers.barriers.count, 3, this.instanceLayout, true);
    this.signs = this.createInstanceLayer('road signs', signBuffer, this.manifest.buffers.signs.count, 4, this.instanceLayout, true);
    this.borders = this.createInstanceLayer('borders', borderBuffer, this.manifest.buffers.borders.count, 0, this.lineLayout);
    this.createStrategicMarkerLayer();
    this.createArmyMarkerLayer();
    this.updateBorderVisibility();
    if (this.countryLabelCanvas) {
      await loadCountryLabelFont();
      this.countryLabels = new CountryLabelLayer(
        this.countryLabelCanvas,
        this.manifest.politics.countries,
        this.provinceOwners,
        new Uint32Array(provinceAdjacencyData),
        new Float32Array(provinceLabelData),
        this.manifest.world.width,
        (countryId, x, z) => isValidCountryLabelPoint(
          countryId,
          this.sampleProvince(x, z),
          this.sampleWaterway(x, z),
          this.provinceOwners,
        ),
        Math.max(
          this.manifest.world.width / this.manifest.fields.provinceIds.width,
          this.manifest.world.height / this.manifest.fields.provinceIds.height,
        ),
        (x, z) => this.sampleHeight(x, z),
        Math.min(
          this.manifest.world.width / this.manifest.fields.height.width,
          this.manifest.world.height / this.manifest.fields.height.height,
        ) * 0.5,
      );
      this.createCountryLabelResources();
    }

    this.initialized = true;
    this.attachRuntimeBindings();
    this.resize();
    this.camera.update(0);
    report('World ready', 1);
    this.notifyDiplomacyChange();
  }

  start(): void {
    if (this.disposed) throw new Error('Cannot start a disposed renderer');
    if (!this.initialized) throw new Error('Renderer must be initialized before it can start');
    if (this.running) return;
    this.attachRuntimeBindings();
    this.running = true;
    this.previousTime = performance.now();
    this.frameHandle = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frameHandle);
    this.frameHandle = 0;
    this.detachRuntimeBindings();
  }

  dispose(): void {
    if (this.disposed) return;
    this.stop();
    this.disposed = true;
    this.performanceEpoch += 1;
    this.onHover = undefined;
    this.onStats = undefined;
    this.onDiplomacyChange = undefined;
    this.onProvinceSelected = undefined;
    this.onTimeOfDayChange = undefined;
    if (!this.deviceReady) return;
    this.device.removeEventListener('uncapturederror', this.onUncapturedError);
    if (this.contextConfigured) this.context.unconfigure();
    this.depthTexture?.destroy();
    this.gpuQuerySet?.destroy();
    this.device.destroy();
    this.deviceReady = false;
  }

  setDebugView(mode: number): void {
    this.debugView = mode;
  }

  setTimeOfDay(hour: number): void {
    this.environment.setTimeOfDay(hour);
    this.notifyTimeOfDayChange(true);
  }

  setTimeMultiplier(multiplier: number): number {
    const value = this.environment.setTimeMultiplier(multiplier);
    this.notifyTimeOfDayChange(true);
    return value;
  }

  setRainEnabled(enabled: boolean): void {
    this.environment.setRainEnabled(enabled);
  }

  isRainEnabled(): boolean {
    return this.environment.isRainEnabled();
  }

  getRainIntensity(): number {
    return this.environment.rainIntensity;
  }

  getTimeOfDay(): TimeOfDayState {
    return this.environment.getTimeOfDay();
  }

  setWireframe(enabled: boolean): void {
    this.showWireframe = enabled;
  }

  setBordersVisible(enabled: boolean): void {
    this.showBorders = enabled;
    this.updateBorderVisibility();
  }

  setCountryOverlayVisible(enabled: boolean): void {
    this.showCountryOverlay = enabled;
    this.countryLabels?.setVisible(enabled && this.performanceLayers.countryLabels && this.debugView === 0);
    this.updateBorderVisibility();
  }

  setMapMode(mode: MapMode): void {
    this.mapMode = mode;
  }

  getCountries(): readonly CountryRecord[] {
    return this.manifest.politics.countries;
  }

  findCountry(name: string): CountryRecord | undefined {
    return findCountryByName(this.manifest.politics.countries, name);
  }

  getDiplomacyState(): DiplomacyState {
    const player = this.countryById.get(this.playerCountryId);
    if (!player) throw new Error('The player country is not initialized');
    const countriesFor = (relation: DiplomaticRelation) => [...this.diplomaticRelations]
      .filter(([, value]) => value === relation)
      .map(([countryId]) => this.countryById.get(countryId))
      .filter((country): country is CountryRecord => Boolean(country))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { player, allies: countriesFor('allied'), enemies: countriesFor('war') };
  }

  setPlayerCountryByName(name: string): CountryRecord | undefined {
    const country = this.findCountry(name);
    if (!country) return undefined;
    this.playerCountryId = country.id;
    this.diplomaticRelations.clear();
    this.refreshDiplomacyTexture();
    this.notifyDiplomacyChange();
    return country;
  }

  setDiplomaticRelationByName(name: string, relation: Exclude<DiplomaticRelation, 'neutral'>): CountryRecord | undefined {
    const country = this.findCountry(name);
    if (!country || country.id === this.playerCountryId) return undefined;
    this.diplomaticRelations.set(country.id, relation);
    this.refreshDiplomacyTexture();
    this.notifyDiplomacyChange();
    return country;
  }

  clearDiplomaticRelation(countryId: number): void {
    if (!this.diplomaticRelations.delete(countryId)) return;
    this.refreshDiplomacyTexture();
    this.notifyDiplomacyChange();
  }

  setProvinceOwner(provinceId: number, countryId: number): void {
    this.setProvinceOwners([{ provinceId, countryId }]);
  }

  setProvinceOwners(changes: Array<{ provinceId: number; countryId: number }>): void {
    const ownershipChanges: Array<{ provinceId: number; previousCountryId: number; countryId: number }> = [];
    for (const change of changes) {
      const encodedId = change.provinceId + 1;
      if (encodedId <= 0 || encodedId >= this.provinceOwners.length) throw new Error(`Unknown province ${change.provinceId}`);
      if (!this.countryById.has(change.countryId)) throw new Error(`Unknown country ${change.countryId}`);
      const previousCountryId = this.provinceOwners[encodedId];
      if (previousCountryId === change.countryId) continue;
      this.provinceOwners[encodedId] = change.countryId;
      ownershipChanges.push({ provinceId: encodedId, previousCountryId, countryId: change.countryId });
    }
    this.politicalCache.update(
      ownershipChanges.map((change) => change.provinceId),
      this.device,
      this.provincePoliticalColorTexture,
      this.borders.buffer,
    );
    this.countryLabels?.refreshOwnership(ownershipChanges);
    if (this.hoveredId) this.updateHover(this.hoveredId, true);
  }

  setPropsVisible(enabled: boolean): void { this.showProps = enabled; }

  setRoadsVisible(enabled: boolean): void { this.showRoads = enabled; }

  setHiddenConnectionsVisible(enabled: boolean): void { this.showHiddenConnections = enabled; }

  setWaterwaysVisible(enabled: boolean): void { this.showWaterways = enabled; }

  focus(x: number, z: number, distance = 520, yaw = -0.48, pitch = 0.82): void {
    this.camera.target[0] = wrap(x, this.manifest.world.width);
    this.camera.target[2] = clamp(z, 0, this.manifest.world.height);
    this.camera.distance = clamp(distance, this.camera.minDistance, this.camera.maxDistance);
    this.camera.yaw = yaw;
    this.camera.pitch = pitch;
    this.camera.update(0);
  }

  /**
   * Deterministic player-start view: centred on the player's homeland, north-up,
   * near top-down. No prior camera orientation leaks in. The player can orbit
   * away afterwards (the orbit clamp now reaches this pitch).
   */
  focusPlayerStart(x: number, z: number, distance: number): void {
    this.focus(x, z, distance, PLAYER_START_YAW, PLAYER_START_PITCH);
  }

  getPerformanceSnapshot(): PerformanceSnapshot {
    return this.performanceMonitor.snapshot();
  }

  resetPerformanceSamples(): void {
    this.performanceEpoch += 1;
    this.performanceMonitor.reset();
  }

  setPerformanceLayerVisibility(layers: Partial<PerformanceLayerVisibility>): void {
    Object.assign(this.performanceLayers, layers);
    this.updateBorderVisibility();
  }

  async setConnectionsVisible(enabled: boolean): Promise<void> {
    this.showConnections = enabled;
    if (!enabled || this.connections) return;
    const data = await fetchBinary(worldAssetUrl(this.manifest.buffers.connections.url));
    this.connections = this.createInstanceLayer('movement connections', data, this.manifest.buffers.connections.count, 1, this.lineLayout);
  }

  async setWaterwayNetworkVisible(enabled: boolean): Promise<void> {
    this.showWaterwayNetwork = enabled;
    if (!enabled || this.waterwayNetwork) return;
    const data = await fetchBinary(worldAssetUrl(this.manifest.buffers.waterwayNetworkLines.url));
    this.waterwayNetwork = this.createInstanceLayer(
      'authoritative waterway network', data, this.manifest.buffers.waterwayNetworkLines.count, 2, this.lineLayout,
    );
  }

  private createLayouts(): void {
    const layouts = createRendererLayouts(this.device);
    this.commonLayout = layouts.common;
    this.instanceLayout = layouts.instances;
    this.lineLayout = layouts.lines;
    this.countryLabelLayout = layouts.countryLabels;
  }

  private createPipelines(): void {
    const pipelines = createRendererPipelines(this.device, this.format, {
      common: this.commonLayout,
      instances: this.instanceLayout,
      lines: this.lineLayout,
      countryLabels: this.countryLabelLayout,
    });
    this.terrainPipeline = pipelines.terrain;
    this.polarCapPipeline = pipelines.polarCaps;
    this.waterPipeline = pipelines.water;
    this.waterwayPipeline = pipelines.waterways;
    this.infrastructurePipeline = pipelines.infrastructure;
    this.propPipeline = pipelines.props;
    this.cityLightPipeline = pipelines.cityLights;
    this.rainPipeline = pipelines.rain;
    this.linePipeline = pipelines.lines;
    this.mapMarkerPipeline = pipelines.mapMarkers;
    this.armyMarkerPipeline = pipelines.armyMarkers;
    this.armyCompositionPipeline = pipelines.armyComposition;
    this.armyModelPipeline = pipelines.armyModels;
    this.combatEffectPipeline = pipelines.combatEffects;
    this.countryLabelPipeline = pipelines.countryLabels;
  }

  private createCountryLabelResources(): void {
    if (!this.countryLabels) return;
    this.countryLabelBuffer = this.device.createBuffer({
      label: 'country label glyphs',
      size: Math.max(4, this.countryLabels.maximumGlyphCount * 12 * 4),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.countryLabelParamsBuffer = this.device.createBuffer({
      label: 'country label parameters',
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const atlas = this.countryLabels.atlasCanvas;
    const atlasTexture = this.device.createTexture({
      label: 'country label atlas',
      size: [atlas.width, atlas.height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.device.queue.copyExternalImageToTexture(
      { source: atlas },
      { texture: atlasTexture },
      [atlas.width, atlas.height],
    );
    this.countryLabelBindGroup = this.device.createBindGroup({
      label: 'country label bind group',
      layout: this.countryLabelLayout,
      entries: [
        { binding: 0, resource: { buffer: this.countryLabelBuffer } },
        { binding: 1, resource: atlasTexture.createView() },
        { binding: 2, resource: this.device.createSampler({
          magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', maxAnisotropy: 8,
        }) },
        { binding: 3, resource: { buffer: this.countryLabelParamsBuffer } },
      ],
    });
  }

  private updateBorderVisibility(): void {
    if (!this.borders) return;
    const flags = (this.showBorders ? 1 : 0)
      | (this.showCountryOverlay && this.performanceLayers.countryBorders ? 2 : 0);
    this.device.queue.writeBuffer(this.borders.params, 8, new Uint32Array([flags]));
  }

  private createInstanceLayer(
    label: string, data: ArrayBuffer, count: number, kind: number, layout: GPUBindGroupLayout, mappedInstances = false,
  ): InstanceLayer {
    const buffer = this.device.createBuffer({
      label: `${label} records`,
      size: align4(data.byteLength),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(buffer, 0, data);
    const params = this.device.createBuffer({ label: `${label} params`, size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(params, 0, new Uint32Array([count, kind, 1, 0]));
    const entries: GPUBindGroupEntry[] = [{ binding: 0, resource: { buffer } }, { binding: 1, resource: { buffer: params } }];
    let views: InstanceLayer['views'];
    if (mappedInstances) {
      const identityBuffer = this.device.createBuffer({
        label: `${label} identity instances`, size: Math.max(4, count * 3 * 4),
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      const identity = new Uint32Array(count * 3);
      for (let index = 0; index < identity.length; index += 1) identity[index] = index;
      this.device.queue.writeBuffer(identityBuffer, 0, identity);
      entries.push({ binding: 2, resource: { buffer: identityBuffer } });
      views = new Map();
    }
    const bindGroup = this.device.createBindGroup({
      label: `${label} bind group`,
      layout,
      entries,
    });
    return { buffer, params, bindGroup, count, views };
  }

  /**
   * Pack the static settlement layer — road junctions and unnamed towns only —
   * into one instance storage buffer, uploaded once. Resource deposits are NOT
   * here: they are authoritative game state and are drawn from the separate
   * `gameResourceMarkers` layer fed by `setGameResourceMarkers`. Keeping them
   * apart stops a deposit rendering twice and lets the resource overlay toggle
   * gate resources without hiding the junction/town markers.
   *
   * Marker record = f32x4 (worldX, worldZ, kind, richness).
   *   kind: 3 road junction, 4 small town
   */
  private createStrategicMarkerLayer(): void {
    const junctions = this.generateRoadJunctions();
    const data = new Float32Array(Math.max(1, junctions.length) * 4);
    let cursor = 0;
    for (const junction of junctions) {
      data[cursor] = junction.x;
      data[cursor + 1] = junction.z;
      data[cursor + 2] = junction.town ? 4 : 3;
      data[cursor + 3] = 0;
      cursor += 4;
    }
    this.mapMarkers = this.createInstanceLayer(
      'settlement markers', data.buffer as ArrayBuffer, junctions.length, 0, this.lineLayout,
    );
  }

  /** Allocate the fixed-capacity army-marker instance buffer (4 vec4f per
   *  stack). `setArmyMarkers` fills only the used prefix each update. */
  private createArmyMarkerLayer(): void {
    const zero = new Float32Array(WorldRenderer.ARMY_MARKER_CAPACITY * 16);
    this.armyMarkers = this.createInstanceLayer(
      'army stack markers', zero.buffer as ArrayBuffer, 0, 0, this.lineLayout,
    );
    const zeroModels = new Float32Array(WorldRenderer.ARMY_MODEL_CAPACITY * 12);
    this.armyModels = this.createInstanceLayer(
      'army formation models', zeroModels.buffer as ArrayBuffer, 0, 0, this.lineLayout,
    );
    const zeroR = new Float32Array(WorldRenderer.RESOURCE_MARKER_CAPACITY * 4);
    this.gameResourceMarkers = this.createInstanceLayer(
      'game resource markers', zeroR.buffer as ArrayBuffer, 0, 0, this.lineLayout,
    );
    const zeroRoutes = new Float32Array(WorldRenderer.ROUTE_SEGMENT_CAPACITY * 8);
    this.routeLines = this.createInstanceLayer(
      'order routes', zeroRoutes.buffer as ArrayBuffer, 0, 3, this.lineLayout,
    );
    const zeroEffects = new Float32Array(WorldRenderer.COMBAT_EFFECT_CAPACITY * 8);
    this.combatEffects = this.createInstanceLayer(
      'combat effects', zeroEffects.buffer as ArrayBuffer, 0, 0, this.lineLayout,
    );
  }

  /**
   * Replace the drawn combat effects. `records` is 8 floats per instance
   * (see combatEffectShader); `count` is the used prefix. One buffer write.
   */
  setCombatEffects(records: Float32Array, count: number): void {
    if (!this.combatEffects) return;
    const capped = Math.min(count, WorldRenderer.COMBAT_EFFECT_CAPACITY);
    if (capped > 0) {
      this.device.queue.writeBuffer(
        this.combatEffects.buffer, 0,
        records.buffer as ArrayBuffer, records.byteOffset, capped * 8 * 4,
      );
    }
    this.device.queue.writeBuffer(
      this.combatEffects.params, 0, new Uint32Array([Math.max(1, capped), 0, 1, 0]),
    );
    this.combatEffects.count = capped;
  }

  /** Camera distance past which combat effects stop drawing (markers only). */
  get combatEffectMaxDistance(): number {
    return WorldRenderer.COMBAT_EFFECT_MAX_DISTANCE;
  }

  /**
   * Replace the drawn order-route polylines. `records` is 8 floats per segment
   * (LineRecord: a = x0,z0,x1,z1; b = colorFlag, dim, retreatFlag, 0), where
   * colorFlag 0 = move / 1 = attack, dim > 0.5 = a non-selected army's route,
   * retreatFlag > 0.5 = withdrawal. One buffer write, no pipeline churn.
   */
  setOrderRoutes(records: Float32Array, count: number): void {
    if (!this.routeLines) return;
    const capped = Math.min(count, WorldRenderer.ROUTE_SEGMENT_CAPACITY);
    if (capped > 0) {
      this.device.queue.writeBuffer(
        this.routeLines.buffer, 0,
        records.buffer as ArrayBuffer, records.byteOffset, capped * 8 * 4,
      );
    }
    this.device.queue.writeBuffer(
      this.routeLines.params, 0, new Uint32Array([Math.max(1, capped), 3, 1, 0]),
    );
    this.routeLines.count = capped;
  }

  /** Replace the authoritative resource-deposit markers. `records` is 4 floats
   *  per node: (worldX, worldZ, kind[0 stone/1 metal/2 oil], richness 0..1). */
  setGameResourceMarkers(records: Float32Array, count: number): void {
    if (!this.gameResourceMarkers) return;
    const capped = Math.min(count, WorldRenderer.RESOURCE_MARKER_CAPACITY);
    if (capped > 0) {
      this.device.queue.writeBuffer(
        this.gameResourceMarkers.buffer, 0,
        records.buffer as ArrayBuffer, records.byteOffset, capped * 4 * 4,
      );
    }
    this.device.queue.writeBuffer(
      this.gameResourceMarkers.params, 0, new Uint32Array([Math.max(1, capped), 0, 1, 0]),
    );
    this.gameResourceMarkers.count = capped;
  }

  /**
   * Replace the drawn army markers. `records` is 16 floats per stack; see
   * `armyMarkerShader`. `count` stacks are drawn; the rest of the capacity is
   * ignored. Cheap: one buffer write, no pipeline or bind-group churn.
   */
  setArmyMarkers(
    records: Float32Array, count: number,
    pickList: ReadonlyArray<{ id: string; x: number; z: number }> = [],
    modelRecords: Float32Array = new Float32Array(), modelCount = 0,
  ): void {
    if (!this.armyMarkers) return;
    const capped = Math.min(count, WorldRenderer.ARMY_MARKER_CAPACITY);
    if (capped > 0) {
      this.device.queue.writeBuffer(
        this.armyMarkers.buffer, 0,
        records.buffer as ArrayBuffer, records.byteOffset, capped * 16 * 4,
      );
    }
    this.device.queue.writeBuffer(
      this.armyMarkers.params, 0, new Uint32Array([Math.max(1, capped), 0, 1, 0]),
    );
    this.armyMarkers.count = capped;
    if (this.armyModels) {
      const cappedModels = Math.min(modelCount, WorldRenderer.ARMY_MODEL_CAPACITY);
      if (cappedModels > 0) {
        for (let index = 0; index < cappedModels; index += 1) modelRecords[index * 12 + 10] = this.elapsed;
        this.device.queue.writeBuffer(
          this.armyModels.buffer, 0,
          modelRecords.buffer as ArrayBuffer, modelRecords.byteOffset, cappedModels * 12 * 4,
        );
      }
      this.device.queue.writeBuffer(
        this.armyModels.params, 0, new Uint32Array([Math.max(1, cappedModels), 0, 1, 0]),
      );
      this.armyModels.count = cappedModels;
    }
    this.armyPickList = pickList;
  }

  private armyPickList: ReadonlyArray<{ id: string; x: number; z: number }> = [];

  /** World-space ground point under a screen coordinate, or null over sky. */
  groundPointAt(clientX: number, clientY: number): [number, number] | null {
    const point = pickTerrainPoint(
      this.camera, clientX, clientY,
      this.manifest.terrain.maxHeight, this.manifest.world.height,
      (x, z) => this.sampleHeight(x, z), this.pickPoint,
    );
    return point ? [point[0], point[2]] : null;
  }

  /** Raw province id under a screen point, for typed province attack orders. */
  provinceIdAt(clientX: number, clientY: number): number {
    return this.provinceAtScreenPoint(clientX, clientY);
  }

  /** Army stack marker under a screen coordinate (nearest within a
   *  zoom-scaled world radius), or null. */
  pickArmyAt(clientX: number, clientY: number): string | null {
    if (this.camera.distance >= 5_000) return null;
    const ground = this.groundPointAt(clientX, clientY);
    if (!ground) return null;
    const radius = Math.max(28, this.camera.distance * 0.045);
    const w = this.manifest.world.width;
    let best: string | null = null;
    let bestSq = radius * radius;
    for (const entry of this.armyPickList) {
      let dx = entry.x - ground[0];
      if (dx > w / 2) dx -= w; else if (dx < -w / 2) dx += w;
      const dz = entry.z - ground[1];
      const dSq = dx * dx + dz * dz;
      if (dSq < bestSq) { bestSq = dSq; best = entry.id; }
    }
    return best;
  }

  /**
   * Classify vertices of the movement/road graph by degree. Degree >= 3 is a
   * crossroads; a deterministic subset of degree >= 4 vertices is promoted to
   * an unnamed town. Filtered to land, a minimum spacing between markers, and a
   * minimum distance from the nearest labelled settlement so junction dots
   * never crowd real cities. Returns [] when the graph is not loaded.
   */
  private generateRoadJunctions(): Array<{ x: number; z: number; town: boolean }> {
    const graph = this.connectionGraph;
    if (!graph || graph.length < 4) return [];
    const CELL = 26;                 // world units — merges shared vertices
    const MIN_SPACING = 150;         // between kept junction markers
    const MIN_CITY_DISTANCE = 170;   // from one of the 250 largest settlements
    const degree = new Map<number, { x: number; z: number; n: number }>();
    const key = (x: number, z: number): number =>
      Math.round(x / CELL) * 100_000 + Math.round(z / CELL);
    for (let i = 0; i + 3 < graph.length; i += 4) {
      for (const [x, z] of [[graph[i], graph[i + 1]], [graph[i + 2], graph[i + 3]]] as const) {
        const k = key(x, z);
        const entry = degree.get(k);
        if (entry) entry.n += 1;
        else degree.set(k, { x, z, n: 1 });
      }
    }
    const cities = this.settlementCenters;
    const kept: Array<{ x: number; z: number; town: boolean }> = [];
    const candidates = [...degree.values()]
      .filter((v) => v.n >= 3)
      .sort((a, b) => b.n - a.n);
    for (const v of candidates) {
      if (kept.length >= 500) break;
      if (this.sampleHeight(v.x, v.z) <= 0.05) continue; // land only
      if (cities.some((c) => Math.hypot(c[0] - v.x, c[1] - v.z) < MIN_CITY_DISTANCE)) continue;
      if (kept.some((m) => Math.hypot(m.x - v.x, m.z - v.z) < MIN_SPACING)) continue;
      const town = v.n >= 4 && (Math.round(v.x * 7 + v.z * 13) & 7) === 0;
      kept.push({ x: v.x, z: v.z, town });
    }
    return kept;
  }

  private attachRuntimeBindings(): void {
    if (this.runtimeBindingsAttached) return;
    this.runtimeBindingsAttached = true;
    this.camera.attach(this.canvas);
    this.interactionAbort = new AbortController();
    this.attachInteraction(this.interactionAbort.signal);
    this.resizeObserver ??= new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.canvas);
    this.renderingSuspended = document.hidden;
    document.addEventListener('visibilitychange', this.onVisibilityChange, {
      signal: this.interactionAbort.signal,
    });
  }

  private detachRuntimeBindings(): void {
    if (!this.runtimeBindingsAttached) return;
    this.runtimeBindingsAttached = false;
    this.camera.detach();
    this.interactionAbort?.abort();
    this.interactionAbort = undefined;
    this.resizeObserver?.disconnect();
    this.clickStart = undefined;
    this.pointer.inside = false;
    this.pickingDirty = false;
    this.updateHover(0);
  }

  private attachInteraction(signal: AbortSignal): void {
    // Right-click issues an order for the selected army (see main.ts). The
    // browser context menu is already suppressed by the camera; this makes the
    // gameplay layer act on it.
    this.canvas.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      this.onMapCommand?.(event.clientX, event.clientY);
    }, { signal });
    this.canvas.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      if (event.pointerType === 'touch' && !event.isPrimary) {
        this.clickStart = undefined;
        return;
      }
      this.clickStart = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
      this.pointer.x = event.clientX;
      this.pointer.y = event.clientY;
      this.pointer.inside = true;
      this.pickingDirty = true;
    }, { signal });
    window.addEventListener('pointerup', (event) => {
      const start = this.clickStart;
      this.clickStart = undefined;
      if (!start || start.pointerId !== event.pointerId || event.button !== 0) return;
      const tapSlop = event.pointerType === 'touch' ? 12 : 5;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > tapSlop) return;
      // Gameplay layer gets first refusal on a map tap (army pick / move
      // order). If it handled the click, do not also select a province.
      if (this.onMapClick?.(event.clientX, event.clientY)) return;
      if (event.pointerType === 'touch') {
        this.pointer.x = event.clientX;
        this.pointer.y = event.clientY;
        this.pointer.inside = true;
        this.finishPicking(this.provinceAtScreenPoint(event.clientX, event.clientY), performance.now());
      }
      this.selectProvinceAt(event.clientX, event.clientY);
    }, { signal });
    window.addEventListener('pointercancel', () => {
      this.clickStart = undefined;
    }, { signal });
    this.canvas.addEventListener('pointermove', (event) => {
      this.pointer.x = event.clientX;
      this.pointer.y = event.clientY;
      this.pointer.inside = true;
      this.pickingDirty = true;
    }, { signal });
    this.canvas.addEventListener('pointerleave', (event) => {
      if (event.pointerType === 'touch') return;
      this.pointer.inside = false;
      this.pickingDirty = false;
      this.updateHover(0);
    }, { signal });
  }

  private resize(): void {
    // Backing-store scale is the graphics-quality preset (0.75 / 1.0 / 1.25 /
    // 1.5), applied absolutely and capped at 1.5 so a 2x/3x HiDPI panel never
    // forces an oversized buffer. devicePixelRatio is deliberately not a
    // multiplier here. This supersedes PR #36's flat min(dpr, 1.5) cap.
    const pixelRatio = resolveRenderPixelRatio(this.quality);
    const width = Math.max(1, Math.floor(this.canvas.clientWidth * pixelRatio));
    const height = Math.max(1, Math.floor(this.canvas.clientHeight * pixelRatio));
    if (this.canvas.width === width && this.canvas.height === height) return;
    this.canvas.width = width;
    this.canvas.height = height;
    this.context.configure({ device: this.device, format: this.format, alphaMode: 'opaque' });
    this.contextConfigured = true;
    this.depthTexture?.destroy();
    this.depthTexture = this.device.createTexture({
      label: 'main depth',
      size: [width, height],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.camera.resize(width, height);
  }

  private onVisibilityChange = (): void => {
    this.renderingSuspended = document.hidden;
    if (!document.hidden) this.previousTime = performance.now();
  };

  private frame = (time: number): void => {
    if (!this.running) return;
    // Tab hidden: keep the loop alive so a return to the tab resumes with the
    // same camera/state and no reload, but skip all rendering and picking.
    if (this.renderingSuspended) {
      this.previousTime = time;
      this.frameHandle = requestAnimationFrame(this.frame);
      return;
    }
    const frameStarted = performance.now();
    const frameMs = Math.max(0, time - this.previousTime);
    const deltaMs = Math.min(50, frameMs);
    this.previousTime = time;
    this.elapsed += deltaMs / 1000;
    this.environment.update(Math.min(frameMs, 250) / 1000, deltaMs / 1000);
    this.notifyTimeOfDayChange();

    let phaseStarted = performance.now();
    this.camera.update(deltaMs / 1000);
    this.resize();
    this.updateVisibleTerrainChunks();
    const cameraMs = performance.now() - phaseStarted;

    phaseStarted = performance.now();
    this.updateUniforms();
    const uniformsMs = performance.now() - phaseStarted;

    phaseStarted = performance.now();
    this.countryLabels?.setVisible(this.showCountryOverlay && this.performanceLayers.countryLabels && this.debugView === 0);
    const labelsAboveFadeEnd = this.camera.position[1] > COUNTRY_LABEL_FADE_END_ALTITUDE;
    const visibleLabels = labelsAboveFadeEnd ? this.countryLabels?.visibleLabelCount ?? 0 : 0;
    const visibleLabelGlyphs = labelsAboveFadeEnd ? this.countryLabels?.visibleGlyphCount ?? 0 : 0;
    if (this.countryLabels
      && this.countryLabelBuffer
      && this.countryLabelParamsBuffer
      && this.countryLabels.renderRevision !== this.lastCountryLabelRevision) {
      const data = this.countryLabels.renderData;
      if (data.byteLength) {
        this.device.queue.writeBuffer(
          this.countryLabelBuffer, 0, data.buffer as ArrayBuffer, data.byteOffset, data.byteLength,
        );
      }
      this.device.queue.writeBuffer(
        this.countryLabelParamsBuffer, 0, new Uint32Array([data.length / 12, WORLD_COPY_INDICES.length, 0, 0]),
      );
      this.lastCountryLabelRevision = this.countryLabels.renderRevision;
    }
    const labelsMs = performance.now() - phaseStarted;

    let pickRaycastMs = 0;
    let hoverUiMs = 0;
    if (this.pointer.inside && this.lastPickedCameraRevision !== this.camera.revision) this.pickingDirty = true;
    if (this.pointer.inside && this.pickingDirty && time - this.lastPickTime >= 32) {
      const picking = this.pickProvince(this.pointer.x, this.pointer.y);
      pickRaycastMs = picking.raycastMs;
      hoverUiMs = picking.hoverUiMs;
      this.pickingDirty = false;
      this.lastPickTime = time;
      this.lastPickedCameraRevision = this.camera.revision;
    }

    phaseStarted = performance.now();
    this.render(visibleLabels, visibleLabelGlyphs);
    const renderMs = performance.now() - phaseStarted;
    const phases: PerformancePhases = {
      camera: cameraMs,
      uniforms: uniformsMs,
      labels: labelsMs,
      pickRaycast: pickRaycastMs,
      hoverUi: hoverUiMs,
      render: renderMs,
    };
    this.performanceMonitor.record({ frameMs, mainThreadMs: performance.now() - frameStarted, phases }, this.frameWorkload);
    this.updateStats();
    this.frameHandle = requestAnimationFrame(this.frame);
  };

  private updateUniforms(): void {
    const tintMode = this.showCountryOverlay && this.performanceLayers.countryTint
      ? this.mapMode === 'diplomacy' ? 3 : this.mapMode === 'political' ? 2 : this.mapMode === 'balanced' ? 1 : 0
      : 0;
    const countryBordersEnabled = this.showCountryOverlay && this.performanceLayers.countryBorders ? 1 : 0;
    const lighting = this.environment.lighting;
    const skyColor = this.environment.skyColor;
    const values = packFrameUniforms({
      viewProjection: this.camera.viewProjection,
      inverseViewProjection: this.camera.inverseViewProjection,
      camera: [this.camera.position[0], this.camera.position[1], this.camera.position[2], this.camera.target[0]],
      sunTime: [...lighting.sunDirection, this.elapsed],
      viewport: [this.canvas.width, this.canvas.height, 1 / this.canvas.width, 1 / this.canvas.height],
      map: [this.manifest.world.width, this.manifest.world.height, this.manifest.terrain.maxHeight, this.debugView],
      interaction: [this.hoveredId, this.camera.distance, tintMode, countryBordersEnabled],
      terrainInfo: [this.manifest.terrain.chunksX, this.manifest.terrain.chunksY, this.manifest.terrain.gridResolution, this.showWireframe ? 1 : 0],
      lighting: [lighting.daylight, lighting.twilight, lighting.night, this.environment.dayPhase],
      sky: [...skyColor, 0],
      // weather.y = quality index (0 low .. 3 ultra), weather.z = 0..1 detail
      // factor. Shaders can scale purely-decorative expensive work by these
      // without a struct change. weather.w = encoded (1-based) selected
      // province id, 0 when nothing is selected (border shader outline).
      weather: [
        this.environment.rainIntensity,
        QUALITY_LEVELS.indexOf(this.quality),
        this.qualityPreset.detailFactor,
        this.selectedId,
      ],
    });
    this.device.queue.writeBuffer(this.uniformBuffer, 0, values);
  }

  private render(visibleLabels: number, visibleLabelGlyphs: number): void {
    if (!this.depthTexture) return;
    this.frameWorkload = createEmptyRenderWorkload(visibleLabels);
    const collectGpuTiming = Boolean(this.gpuQuerySet && this.gpuResolveBuffer && this.gpuReadBuffer)
      && !this.gpuReadPending && this.gpuQueryCountdown++ % 4 === 0;
    const gpuTimingEpoch = this.performanceEpoch;
    const frame = beginWorldFrame(
      this.device,
      this.context,
      this.depthTexture,
      this.environment.skyColor,
      collectGpuTiming ? this.gpuQuerySet : undefined,
    );
    const pass = frame.pass;

    pass.setBindGroup(0, this.commonBindGroup);
    pass.setPipeline(this.polarCapPipeline);
    pass.setVertexBuffer(0, this.polarCapMesh.vertex);
    pass.setIndexBuffer(this.polarCapMesh.index, 'uint16');
    pass.drawIndexed(this.polarCapMesh.indexCount, 6);
    this.recordIndexedDraw('polarCaps', this.polarCapMesh.indexCount, 6);
    this.frameWorkload.visibleChunks.terrain = this.terrainLodDraws.reduce((sum, draw) => sum + draw.instanceCount, 0);
    for (const draw of this.terrainLodDraws) this.frameWorkload.lodInstances.terrain[draw.lod] += draw.instanceCount;
    if (this.performanceLayers.ocean) {
      pass.setPipeline(this.waterPipeline);
      for (const draw of this.terrainLodDraws) {
        const mesh = this.waterMeshes[draw.lod];
        pass.setVertexBuffer(0, mesh.vertex);
        pass.setIndexBuffer(mesh.index, 'uint16');
        pass.drawIndexed(mesh.indexCount, draw.instanceCount, 0, 0, draw.firstInstance);
        this.recordIndexedDraw('water', mesh.indexCount, draw.instanceCount);
      }
    }

    if (this.performanceLayers.terrain) {
      pass.setPipeline(this.terrainPipeline);
      for (const draw of this.terrainLodDraws) {
        const mesh = this.terrainMeshes[draw.lod];
        pass.setVertexBuffer(0, mesh.vertex);
        pass.setIndexBuffer(mesh.index, 'uint16');
        pass.drawIndexed(mesh.indexCount, draw.instanceCount, 0, 0, draw.firstInstance);
        this.recordIndexedDraw('terrain', mesh.indexCount, draw.instanceCount);
      }
    }

    if (this.showWaterways) {
      pass.setPipeline(this.waterwayPipeline);
      pass.setVertexBuffer(0, this.waterwayMesh.vertex);
      pass.setIndexBuffer(this.waterwayMesh.index, 'uint32');
      this.drawChunkedInfrastructure(pass, this.manifest.infrastructureChunks.waterways, 'waterways', 9_200);
    }

    if (this.showRoads || this.showHiddenConnections) pass.setPipeline(this.infrastructurePipeline);
    if (this.showRoads) {
      pass.setVertexBuffer(0, this.roadMesh.vertex);
      pass.setIndexBuffer(this.roadMesh.index, 'uint32');
      this.drawChunkedInfrastructure(pass, this.manifest.infrastructureChunks.roads, 'roads');
    }
    if (this.showHiddenConnections) {
      pass.setVertexBuffer(0, this.hiddenConnectionMesh.vertex);
      pass.setIndexBuffer(this.hiddenConnectionMesh.index, 'uint32');
      this.drawChunkedInfrastructure(pass, this.manifest.infrastructureChunks.hiddenConnections, 'hiddenLinks', 8_000);
    }

    const labelsAboveProps = this.camera.distance >= LABELS_ABOVE_PROPS_DISTANCE;
    if (!labelsAboveProps) this.drawCountryLabels(pass, visibleLabelGlyphs);

    if (this.showProps) {
      pass.setPipeline(this.propPipeline);
      // Graphics-quality scales prop draw + LOD distances down; low/medium
      // drop decorative road furniture entirely.
      const s = this.qualityPreset.propDistanceScale;
      const d2 = (a: number, b: number): [number, number] => [a * s, b * s];
      if (this.performanceLayers.trees) {
        this.drawPropChunks(pass, this.trees, this.manifest.propChunks.trees, this.treeMeshes, 'trees', 3_200 * s, d2(900, 1_850));
      }
      if (this.performanceLayers.buildings) {
        this.drawPropChunks(pass, this.buildings, this.manifest.propChunks.buildings, this.buildingMeshes, 'buildings', 2_600 * s, d2(850, 1_650));
      }
      if (this.performanceLayers.roadFurniture && this.qualityPreset.furniture) {
        this.drawPropChunks(pass, this.lamps, this.manifest.propChunks.lamps, [[this.lampMesh]], 'roadFurniture', 1_900 * s, d2(1_900, 1_900));
        this.drawPropChunks(pass, this.barriers, this.manifest.propChunks.barriers, [[this.barrierMesh]], 'roadFurniture', 1_900 * s, d2(1_900, 1_900));
        this.drawPropChunks(pass, this.signs, this.manifest.propChunks.signs, [[this.signMesh]], 'roadFurniture', 1_900 * s, d2(1_900, 1_900));
      }
      if (this.performanceLayers.buildings) this.drawCityLights(pass);
    }

    this.drawRain(pass);
    if (labelsAboveProps) this.drawCountryLabels(pass, visibleLabelGlyphs);

    pass.setPipeline(this.linePipeline);
    if (this.showBorders || (this.showCountryOverlay && this.performanceLayers.countryBorders)) {
      pass.setBindGroup(1, this.borders.bindGroup);
      this.drawChunkedLines(pass, this.borders, this.manifest.borderChunks.ranges, 'borders');
    }
    if (this.showConnections && this.connections) {
      pass.setBindGroup(1, this.connections.bindGroup);
      const instances = this.connections.count * WORLD_COPY_INDICES.length;
      pass.draw(6, instances, 0, WORLD_COPY_INDICES[0] * this.connections.count);
      this.recordTriangleDraw('debugLines', instances * 2, instances);
    }
    if (this.showWaterwayNetwork && this.waterwayNetwork) {
      pass.setBindGroup(1, this.waterwayNetwork.bindGroup);
      const instances = this.waterwayNetwork.count * WORLD_COPY_INDICES.length;
      pass.draw(6, instances, 0, WORLD_COPY_INDICES[0] * this.waterwayNetwork.count);
      this.recordTriangleDraw('debugLines', instances * 2, instances);
    }
    // Own-army movement / attack routes: authoritative road path, terrain-draped,
    // only below strategic altitude (declutters the overview).
    if (this.routeLines && this.routeLines.count > 0
      && this.camera.distance < WorldRenderer.ROUTE_MAX_DISTANCE) {
      pass.setBindGroup(1, this.routeLines.bindGroup);
      const instances = this.routeLines.count * WORLD_COPY_INDICES.length;
      pass.draw(6, instances, 0, WORLD_COPY_INDICES[0] * this.routeLines.count);
      this.recordTriangleDraw('debugLines', instances * 2, instances);
    }

    // Strategic map markers. Two independent instanced draws, both projected on
    // the GPU — locked to the terrain while panning, no CPU/DOM cost, only below
    // strategic altitude (the shader fades the last stretch so nothing pops).
    //   - settlement markers (junctions/towns): always shown at map zoom;
    //   - resource deposits: gated by the resource-overlay toggle.
    if (this.camera.distance < MAP_MARKER_MAX_DISTANCE) {
      pass.setPipeline(this.mapMarkerPipeline);
      if (this.mapMarkers && this.mapMarkers.count > 0) {
        pass.setBindGroup(1, this.mapMarkers.bindGroup);
        const instances = this.mapMarkers.count * WORLD_COPY_INDICES.length;
        pass.draw(6, instances, 0, WORLD_COPY_INDICES[0] * this.mapMarkers.count);
        this.recordTriangleDraw('debugLines', instances * 2, instances);
      }
      if (this.showResourceOverlay && this.gameResourceMarkers && this.gameResourceMarkers.count > 0) {
        pass.setBindGroup(1, this.gameResourceMarkers.bindGroup);
        const instances = this.gameResourceMarkers.count * WORLD_COPY_INDICES.length;
        pass.draw(6, instances, 0, WORLD_COPY_INDICES[0] * this.gameResourceMarkers.count);
        this.recordTriangleDraw('debugLines', instances * 2, instances);
      }
    }
    // World-space combat effects (muzzle / tracer / impact / smoke / explosion /
    // battle markers). Drawn under the army markers so smoke never hides a
    // stack; the CPU pool already distance-culled the transients.
    if (this.combatEffects && this.combatEffects.count > 0
      && this.camera.distance < WorldRenderer.COMBAT_EFFECT_MAX_DISTANCE && this.debugView === 0) {
      const instances = this.combatEffects.count * WORLD_COPY_INDICES.length;
      pass.setPipeline(this.combatEffectPipeline);
      pass.setBindGroup(1, this.combatEffects.bindGroup);
      pass.draw(6, instances, 0, WORLD_COPY_INDICES[0] * this.combatEffects.count);
      this.recordTriangleDraw('debugLines', instances * 2, instances);
    }
    // Army-stack markers: always on (they are gameplay, not an overlay), and
    // visible further out than the resource overlay. The shader fades the last
    // stretch before strategic altitude.
    if (this.armyModels && this.armyModels.count > 0 && this.camera.distance < this.armyModelDrawDistance) {
      const instances = this.armyModels.count * WORLD_COPY_INDICES.length;
      pass.setPipeline(this.armyModelPipeline);
      pass.setBindGroup(1, this.armyModels.bindGroup);
      pass.draw(WorldRenderer.ARMY_MODEL_VERTEX_COUNT, instances, 0, WORLD_COPY_INDICES[0] * this.armyModels.count);
      this.recordTriangleDraw('roadFurniture', WorldRenderer.ARMY_MODEL_VERTEX_COUNT / 3 * instances, instances);
    }
    if (this.armyMarkers && this.armyMarkers.count > 0 && this.camera.distance < 5_000) {
      pass.setBindGroup(1, this.armyMarkers.bindGroup);
      const instances = this.armyMarkers.count * WORLD_COPY_INDICES.length;
      if (this.camera.distance < 1_900) {
        pass.setPipeline(this.armyCompositionPipeline);
        pass.draw(6, instances, 0, WORLD_COPY_INDICES[0] * this.armyMarkers.count);
        this.recordTriangleDraw('debugLines', instances * 2, instances);
      }
      pass.setPipeline(this.armyMarkerPipeline);
      pass.draw(6, instances, 0, WORLD_COPY_INDICES[0] * this.armyMarkers.count);
      this.recordTriangleDraw('debugLines', instances * 2, instances);
    }
    submitWorldFrame(
      this.device,
      frame,
      collectGpuTiming ? this.gpuQuerySet : undefined,
      collectGpuTiming ? this.gpuResolveBuffer : undefined,
      collectGpuTiming ? this.gpuReadBuffer : undefined,
    );
    if (collectGpuTiming) this.readGpuTiming(gpuTimingEpoch);
  }

  private notifyTimeOfDayChange(force = false): void {
    const clock = this.environment.getTimeOfDay().clock;
    if (!force && clock === this.reportedClock) return;
    this.reportedClock = clock;
    this.onTimeOfDayChange?.(this.getTimeOfDay());
  }

  private drawRain(pass: GPURenderPassEncoder): void {
    if (this.environment.rainIntensity < 0.005 || this.debugView !== 0) return;
    const viewportParticles = Math.ceil(
      this.canvas.width * this.canvas.height / 2_200 * this.qualityPreset.rainScale,
    );
    const particles = Math.min(MAX_RAIN_PARTICLES, Math.max(MIN_RAIN_PARTICLES, viewportParticles));
    pass.setPipeline(this.rainPipeline);
    pass.draw(6, particles);
    this.recordTriangleDraw('weather', particles * 2, particles);
  }

  private drawCityLights(pass: GPURenderPassEncoder): void {
    const viewKey = 'cityLights';
    const view = getVisibleInstanceView(this.device, this.instanceLayout, this.buildings, viewKey, 'city light');
    if (view.revision !== this.camera.revision) {
      const visibility = buildPropVisibility(
        this.manifest,
        this.manifest.propChunks.buildings,
        this.buildingMeshes.map((group) => [group[group.length - 1]]),
        this.buildings.count,
        this.camera.position,
        Math.max(24_000, this.manifest.world.width * 1.2),
        [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
        (centerX, centerZ, radius) => this.chunkIntersectsView(centerX, centerZ, radius),
      );
      updateVisibleInstanceView(this.device.queue, view, this.camera.revision, visibility);
    }
    this.frameWorkload.visibleChunks.buildings = Math.max(
      this.frameWorkload.visibleChunks.buildings,
      view.visibleChunks,
    );
    pass.setPipeline(this.cityLightPipeline);
    pass.setBindGroup(1, view.bindGroup);
    for (const draw of view.draws) {
      pass.draw(6, draw.instanceCount, 0, draw.firstInstance);
      this.recordTriangleDraw('buildings', draw.instanceCount * 2, draw.instanceCount);
    }
  }

  private drawPropChunks(
    pass: GPURenderPassEncoder,
    layer: InstanceLayer,
    ranges: PropChunkRange[],
    groupMeshes: Mesh[][],
    category: RenderCategory,
    maximumDistance: number,
    lodDistances: [number, number],
  ): void {
    if (this.camera.position[1] > maximumDistance * 1.15) return;
    const viewKey = String(category);
    const view = getVisibleInstanceView(this.device, this.instanceLayout, layer, viewKey, category);
    if (view.revision !== this.camera.revision) {
      const budget = category === 'trees'
        ? this.qualityPreset.treeInstanceBudget
        : category === 'buildings'
          ? this.qualityPreset.buildingInstanceBudget
          : Number.POSITIVE_INFINITY;
      const visibility = capVisibleInstances(buildPropVisibility(
        this.manifest,
        ranges,
        groupMeshes,
        layer.count,
        this.camera.position,
        maximumDistance,
        lodDistances,
        (centerX, centerZ, radius) => this.chunkIntersectsView(centerX, centerZ, radius),
      ), budget);
      updateVisibleInstanceView(this.device.queue, view, this.camera.revision, visibility);
    }
    if (category === 'trees') this.frameWorkload.visibleChunks.trees += view.visibleChunks;
    else if (category === 'buildings') this.frameWorkload.visibleChunks.buildings += view.visibleChunks;
    else if (category === 'roadFurniture') this.frameWorkload.visibleChunks.roadFurniture += view.visibleChunks;
    pass.setBindGroup(1, view.bindGroup);
    for (const draw of view.draws) {
      pass.setVertexBuffer(0, draw.mesh.vertex);
      pass.setIndexBuffer(draw.mesh.index, 'uint16');
      pass.drawIndexed(draw.mesh.indexCount, draw.instanceCount, 0, 0, draw.firstInstance);
      this.recordIndexedDraw(category, draw.mesh.indexCount, draw.instanceCount);
      if (category === 'trees') this.frameWorkload.lodInstances.trees[draw.lod] += draw.instanceCount;
      else if (category === 'buildings') this.frameWorkload.lodInstances.buildings[draw.lod] += draw.instanceCount;
    }
  }

  private drawCountryLabels(pass: GPURenderPassEncoder, glyphCount: number): void {
    if (glyphCount <= 0 || !this.countryLabelBindGroup) return;
    const instances = glyphCount * WORLD_COPY_INDICES.length;
    pass.setPipeline(this.countryLabelPipeline);
    pass.setBindGroup(1, this.countryLabelBindGroup);
    pass.draw(6, instances);
    this.recordTriangleDraw('labels', instances * 2, instances);
  }

  private chunkIntersectsView(centerX: number, centerZ: number, radius: number): boolean {
    if (!sphereIntersectsHorizontalWorldWindow(
      centerX, radius, this.camera.target[0], this.manifest.world.width,
    )) return false;
    if (this.frustumPlanesRevision !== this.camera.revision) {
      extractFrustumPlanes(this.camera.viewProjection, this.frustumPlanes);
      this.frustumPlanesRevision = this.camera.revision;
    }
    return sphereIntersectsFrustum(this.frustumPlanes, centerX, this.sampleHeight(centerX, centerZ), centerZ, radius);
  }

  private updateVisibleTerrainChunks(): void {
    if (this.lastTerrainVisibilityRevision === this.camera.revision) return;
    this.lastTerrainVisibilityRevision = this.camera.revision;
    const visibility = buildTerrainVisibility(
      this.manifest,
      this.camera.position,
      (x, z) => this.sampleHeight(x, z),
      (centerX, centerZ, radius) => this.chunkIntersectsView(centerX, centerZ, radius),
      this.qualityPreset.terrainLodScale,
    );
    this.terrainLodDraws = visibility.draws;
    if (visibility.instances.length) {
      this.device.queue.writeBuffer(
        this.visibleTerrainBuffer,
        0,
        visibility.instances.buffer as ArrayBuffer,
        visibility.instances.byteOffset,
        visibility.instances.byteLength,
      );
    }
  }

  private drawChunkedInfrastructure(
    pass: GPURenderPassEncoder,
    ranges: Array<{ firstIndex: number; indexCount: number }>,
    category: 'roads' | 'hiddenLinks' | 'waterways',
    maximumDistance = 4_000,
  ): void {
    if (this.camera.distance >= maximumDistance) return;
    const chunksX = this.manifest.infrastructureChunks.chunksX;
    const chunksY = this.manifest.infrastructureChunks.chunksY;
    const chunkWidth = this.manifest.world.width / chunksX;
    const chunkHeight = this.manifest.world.height / chunksY;
    const radius = clamp(this.camera.distance * 1.48 + 720, 940, maximumDistance + 300);
    const chunkRadius = Math.hypot(chunkWidth, chunkHeight) * 0.6;
    for (const copy of WORLD_COPY_INDICES) {
      const visibleRanges: Array<{ firstIndex: number; indexCount: number }> = [];
      for (let chunkY = 0; chunkY < chunksY; chunkY += 1) {
        for (let chunkX = 0; chunkX < chunksX; chunkX += 1) {
          const range = ranges[chunkY * chunksX + chunkX];
          if (!range?.indexCount) continue;
          const centerX = (chunkX + 0.5) * chunkWidth + (copy - 1) * this.manifest.world.width;
          const centerZ = (chunkY + 0.5) * chunkHeight;
          if (Math.hypot(centerX - this.camera.target[0], centerZ - this.camera.target[2]) > radius + chunkRadius) continue;
          if (!this.chunkIntersectsView(centerX, centerZ, chunkRadius)) continue;
          visibleRanges.push(range);
          this.frameWorkload.visibleChunks[category] += 1;
        }
      }
      visibleRanges.sort((a, b) => a.firstIndex - b.firstIndex);
      let merged: { firstIndex: number; indexCount: number } | undefined;
      for (const range of visibleRanges) {
        if (merged && merged.firstIndex + merged.indexCount === range.firstIndex) {
          merged.indexCount += range.indexCount;
          continue;
        }
        if (merged) {
          pass.drawIndexed(merged.indexCount, 1, merged.firstIndex, 0, copy);
          this.recordIndexedDraw(category, merged.indexCount, 1);
        }
        merged = { ...range };
      }
      if (merged) {
        pass.drawIndexed(merged.indexCount, 1, merged.firstIndex, 0, copy);
        this.recordIndexedDraw(category, merged.indexCount, 1);
      }
    }
  }

  private drawChunkedLines(
    pass: GPURenderPassEncoder,
    layer: InstanceLayer,
    ranges: Array<{ firstInstance: number; instanceCount: number }>,
    category: 'borders',
  ): void {
    const chunksX = this.manifest.borderChunks.chunksX;
    const chunksY = this.manifest.borderChunks.chunksY;
    const chunkWidth = this.manifest.world.width / chunksX;
    const chunkHeight = this.manifest.world.height / chunksY;
    const chunkRadius = Math.hypot(chunkWidth, chunkHeight) * 0.62;
    for (const copy of WORLD_COPY_INDICES) {
      const copyOffset = (copy - 1) * this.manifest.world.width;
      const visibleRanges: Array<{ firstInstance: number; instanceCount: number }> = [];
      for (let chunkIndex = 0; chunkIndex < ranges.length; chunkIndex += 1) {
        const range = ranges[chunkIndex];
        if (!range?.instanceCount) continue;
        const centerX = (chunkIndex % chunksX + 0.5) * chunkWidth + copyOffset;
        const centerZ = (Math.floor(chunkIndex / chunksX) + 0.5) * chunkHeight;
        if (!this.chunkIntersectsView(centerX, centerZ, chunkRadius)) continue;
        visibleRanges.push(range);
        this.frameWorkload.visibleChunks.borders += 1;
      }
      visibleRanges.sort((a, b) => a.firstInstance - b.firstInstance);
      let merged: { firstInstance: number; instanceCount: number } | undefined;
      for (const range of visibleRanges) {
        if (merged && merged.firstInstance + merged.instanceCount === range.firstInstance) {
          merged.instanceCount += range.instanceCount;
          continue;
        }
        if (merged) {
          pass.draw(6, merged.instanceCount, 0, copy * layer.count + merged.firstInstance);
          this.recordTriangleDraw(category, merged.instanceCount * 2, merged.instanceCount);
        }
        merged = { ...range };
      }
      if (merged) {
        pass.draw(6, merged.instanceCount, 0, copy * layer.count + merged.firstInstance);
        this.recordTriangleDraw(category, merged.instanceCount * 2, merged.instanceCount);
      }
    }
  }

  private recordIndexedDraw(category: RenderCategory, indexCount: number, instances: number): void {
    this.recordTriangleDraw(category, Math.floor(indexCount / 3) * instances, instances);
  }

  private recordTriangleDraw(category: RenderCategory, triangles: number, instances: number): void {
    this.frameWorkload.drawCalls += 1;
    this.frameWorkload.triangles += triangles;
    this.frameWorkload.instances += instances;
    this.frameWorkload.trianglesByCategory[category] += triangles;
  }

  private readGpuTiming(epoch: number): void {
    if (!this.gpuReadBuffer || this.gpuReadPending) return;
    this.gpuReadPending = true;
    void this.gpuReadBuffer.mapAsync(GPUMapMode.READ).then(() => {
      if (!this.gpuReadBuffer) return;
      const timestamps = new BigUint64Array(this.gpuReadBuffer.getMappedRange());
      const elapsedNanoseconds = timestamps[1] - timestamps[0];
      if (epoch === this.performanceEpoch) this.performanceMonitor.recordGpu(Number(elapsedNanoseconds) / 1_000_000);
      this.gpuReadBuffer.unmap();
    }).catch((error) => {
      console.warn('GPU timestamp readback failed', error);
      if (this.gpuReadBuffer?.mapState === 'mapped') this.gpuReadBuffer.unmap();
    }).finally(() => {
      this.gpuReadPending = false;
    });
  }

  private pickProvince(clientX: number, clientY: number): { raycastMs: number; hoverUiMs: number } {
    const started = performance.now();
    const id = this.provinceAtScreenPoint(clientX, clientY);
    return this.finishPicking(id, started);
  }

  private provinceAtScreenPoint(clientX: number, clientY: number): number {
    const point = pickTerrainPoint(
      this.camera,
      clientX,
      clientY,
      this.manifest.terrain.maxHeight,
      this.manifest.world.height,
      (x, z) => this.sampleHeight(x, z),
      this.pickPoint,
    );
    return point ? this.sampleProvince(point[0], point[2]) : 0;
  }

  private selectProvinceAt(clientX: number, clientY: number): void {
    const action = resolvePrimaryClick(this.provinceAtScreenPoint(clientX, clientY));
    const encodedId = action.kind === 'select' ? action.encodedProvinceId : 0;
    if (encodedId === this.selectedId) return;
    this.selectedId = encodedId;
    this.onProvinceSelected?.(encodedId ? this.toHoverInfo(encodedId) : null);
  }

  /** Encoded (1-based) id of the selected province, or 0 when nothing is selected. */
  get selectedProvinceId(): number {
    return this.selectedId;
  }

  clearProvinceSelection(): void {
    if (!this.selectedId) return;
    this.selectedId = 0;
    this.onProvinceSelected?.(null);
  }

  private finishPicking(encodedId: number, started: number): { raycastMs: number; hoverUiMs: number } {
    const raycastMs = performance.now() - started;
    const hoverStarted = performance.now();
    this.updateHover(encodedId);
    return { raycastMs, hoverUiMs: performance.now() - hoverStarted };
  }

  private sampleHeight(worldX: number, worldZ: number): number {
    return sampleWrappedField(
      this.heightData,
      this.manifest.fields.height,
      this.manifest.world.width,
      this.manifest.world.height,
      worldX,
      worldZ,
    );
  }

  private sampleProvince(worldX: number, worldZ: number): number {
    return sampleWrappedField(
      this.provinceData,
      this.manifest.fields.provinceIds,
      this.manifest.world.width,
      this.manifest.world.height,
      worldX,
      worldZ,
    );
  }

  private updateHover(encodedId: number, force = false): void {
    if (encodedId === this.hoveredId && !force) {
      if (encodedId !== 0) this.onHover?.(this.toHoverInfo(encodedId), this.pointer.x, this.pointer.y);
      return;
    }
    this.hoveredId = encodedId;
    this.onHover?.(encodedId === 0 ? null : this.toHoverInfo(encodedId), this.pointer.x, this.pointer.y);
  }

  private toHoverInfo(encodedId: number): HoverInfo | null {
    return createHoverInfo(encodedId, this.provinceById, this.countryById, this.provinceOwners);
  }

  private sampleWaterway(worldX: number, worldZ: number): boolean {
    const field = this.manifest.fields.navigation;
    const x = wrap(Math.floor(worldX / this.manifest.world.width * field.width), field.width);
    const y = clamp(Math.floor(worldZ / this.manifest.world.height * field.height), 0, field.height - 1);
    const index = y * field.width + x;
    return (this.waterwayMask[index >>> 3] & (1 << (index & 7))) !== 0;
  }

  private refreshDiplomacyTexture(): void {
    const data = buildDiplomacyColorData(
      this.manifest.politics.countries,
      this.diplomaticRelations,
      this.playerCountryId,
    );
    this.device.queue.writeTexture(
      { texture: this.diplomacyColorTexture },
      data.buffer as ArrayBuffer,
      { bytesPerRow: data.length, rowsPerImage: 1 },
      [data.length / 4, 1],
    );
  }

  private notifyDiplomacyChange(): void {
    this.onDiplomacyChange?.(this.getDiplomacyState());
  }

  private updateStats(): void {
    if (!this.onStats) {
      this.statsFrameCountdown = 0;
      return;
    }
    if (++this.statsFrameCountdown < 20) return;
    this.statsFrameCountdown = 0;
    const performance = this.performanceMonitor.snapshot();
    this.onStats?.({
      fps: performance.frame.average > 0 ? 1000 / performance.frame.average : 0,
      frameMs: performance.frame.average,
      camera: [this.camera.target[0], this.camera.target[2], this.camera.position[1]],
      distance: this.camera.distance,
      hoveredProvince: this.hoveredId ? this.hoveredId - 1 : null,
      trees: this.trees.count,
      buildings: this.buildings.count,
      borderEdges: this.borders.count,
      emittedRoads: this.manifest.counts.emittedRoads,
      hiddenRoads: this.manifest.counts.hiddenRoads,
      riverSystems: this.manifest.counts.riverSystems,
      riverSegments: this.manifest.counts.riverSegments,
      canalSegments: this.manifest.counts.canalSegments,
      targetElevation: this.sampleHeight(this.camera.target[0], this.camera.target[2]),
      targetProvince: (() => {
        const encoded = this.sampleProvince(this.camera.target[0], this.camera.target[2]);
        return encoded ? encoded - 1 : null;
      })(),
      performance,
    });
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function wrap(value: number, size: number): number {
  return ((value % size) + size) % size;
}

function buildWaterwayMask(navigationData: Uint8Array, pixelCount: number): Uint8Array {
  const mask = new Uint8Array(Math.ceil(pixelCount / 8));
  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4;
    if (navigationData[offset + 2] > 114 || navigationData[offset + 3] > 114) {
      mask[index >>> 3] |= 1 << (index & 7);
    }
  }
  return mask;
}
