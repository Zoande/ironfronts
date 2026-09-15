export interface BinaryField {
  url: string;
  width: number;
  height: number;
  format: string;
  mipLevelCount?: number;
}

export interface BinaryBufferDescriptor {
  url: string;
  count: number;
  stride: number;
  lazy?: boolean;
}

export interface ProvinceRecord {
  id: number;
  name: string;
  terrain: string;
}

export interface CountryRecord {
  id: number;
  name: string;
  color: string;
  colorFamily: number;
  capitalProvinceId: number;
}

export type DiplomaticRelation = 'neutral' | 'allied' | 'war';

export interface DiplomacyState {
  player: CountryRecord;
  allies: CountryRecord[];
  enemies: CountryRecord[];
}

export interface WorldManifest {
  version: number;
  generatedSeed: number;
  source: { mapId: string; mapVersion: number };
  world: { width: number; height: number; overlapX: number; wrapX: boolean };
  fields: {
    height: BinaryField;
    surface: BinaryField;
    terrainNormal: BinaryField;
    terrainAlbedo: BinaryField;
    navigation: BinaryField;
    coast: BinaryField;
    provinceIds: BinaryField;
  };
  buffers: {
    borders: BinaryBufferDescriptor;
    connections: BinaryBufferDescriptor;
    roadVertices: BinaryBufferDescriptor;
    roadIndices: BinaryBufferDescriptor;
    hiddenConnectionVertices: BinaryBufferDescriptor;
    hiddenConnectionIndices: BinaryBufferDescriptor;
    waterwayVertices: BinaryBufferDescriptor;
    waterwayIndices: BinaryBufferDescriptor;
    waterwayNetworkLines: BinaryBufferDescriptor;
    trees: BinaryBufferDescriptor;
    buildings: BinaryBufferDescriptor;
    lamps: BinaryBufferDescriptor;
    barriers: BinaryBufferDescriptor;
    signs: BinaryBufferDescriptor;
  };
  terrain: {
    chunksX: number;
    chunksY: number;
    gridResolution: number;
    maxHeight: number;
  };
  infrastructureChunks: {
    chunksX: number;
    chunksY: number;
    roads: Array<{ firstIndex: number; indexCount: number }>;
    hiddenConnections: Array<{ firstIndex: number; indexCount: number }>;
    waterways: Array<{ firstIndex: number; indexCount: number }>;
  };
  borderChunks: {
    chunksX: number;
    chunksY: number;
    ranges: Array<{ firstInstance: number; instanceCount: number }>;
  };
  propChunks: {
    chunksX: number;
    chunksY: number;
    trees: PropChunkRange[];
    buildings: PropChunkRange[];
    lamps: PropChunkRange[];
    barriers: PropChunkRange[];
    signs: PropChunkRange[];
  };
  reports: { generation: { url: string; version: string } };
  sidecars: { provinceDetails: { url: string; version: number } };
  politics: {
    owners: BinaryBufferDescriptor;
    adjacency: BinaryBufferDescriptor;
    labelData: BinaryBufferDescriptor;
    countries: CountryRecord[];
  };
  showcases: {
    urban: [number, number]; mountain: [number, number]; steepRoad: [number, number];
    dirtRoad: [number, number]; hiddenConnection: [number, number];
    europe: [number, number]; lakeRoad: [number, number]; liangshan: [number, number];
    river: [number, number]; riverMouth: [number, number];
    kielCanal: [number, number]; suezCanal: [number, number];
  };
  counts: Record<string, number>;
  provinces: ProvinceRecord[];
}

export interface PropChunkRange {
  firstInstance: number;
  instanceCount: number;
  groups: Array<{ firstInstance: number; instanceCount: number }>;
}

export interface HoverInfo {
  id: number;
  name: string;
  terrain: string;
  country: string;
  countryColor: string;
}

export interface FrameStats {
  fps: number;
  frameMs: number;
  camera: [number, number, number];
  distance: number;
  hoveredProvince: number | null;
  trees: number;
  buildings: number;
  borderEdges: number;
  emittedRoads: number;
  hiddenRoads: number;
  riverSystems: number;
  riverSegments: number;
  canalSegments: number;
  targetElevation: number;
  targetProvince: number | null;
  performance: import('./performance-monitor').PerformanceSnapshot;
}

export type ProgressReporter = (stage: string, progress: number) => void;
