import type { CountryRecord } from './types';
import { CountryLabelAtlas } from '../country-labels/atlas';
import {
  LABEL_GLYPH_STRIDE, layoutCountryLabelWithinTerritory, placeCountryLabelOnTerrain,
} from '../country-labels/layout';
import { createCountryAnchor, type CountryAnchor } from '../country-labels/topology';

export { buildCountryColorBuffer } from '../country-labels/colors';

export interface CountryOwnershipChange {
  provinceId: number;
  previousCountryId: number;
  countryId: number;
}

export class CountryLabelLayer {
  private readonly countryById = new Map<number, CountryRecord>();
  private readonly atlas: CountryLabelAtlas;
  readonly atlasCanvas: HTMLCanvasElement;
  readonly maximumGlyphCount: number;
  private readonly neighbors: number[][];
  private readonly provincesByCountry = new Map<number, Set<number>>();
  private readonly anchors = new Map<number, CountryAnchor>();
  private readonly glyphsByCountry = new Map<number, Float32Array>();
  private readonly visitMarks: Uint32Array;
  private visitEpoch = 0;
  private visible = true;
  private instanceData = new Float32Array(0);
  private instanceRevision = 0;

  constructor(
    canvas: HTMLCanvasElement,
    countries: CountryRecord[],
    private readonly owners: Uint32Array,
    adjacencyPairs: Uint32Array,
    private readonly labelData: Float32Array,
    private readonly worldWidth: number,
    private readonly ownsPoint: (countryId: number, x: number, z: number) => boolean,
    private readonly territorySampleSpacing: number,
    private readonly sampleHeight: (x: number, z: number) => number,
    private readonly heightSampleSpacing: number,
  ) {
    // Retain the old DOM element for API compatibility, but labels now render
    // as world-space WebGPU glyphs rather than a composited screen overlay.
    canvas.hidden = true;
    this.atlas = new CountryLabelAtlas(countries);
    this.atlasCanvas = this.atlas.canvas;
    this.maximumGlyphCount = countries.reduce((count, country) => count
      + [...country.name.toLocaleUpperCase()].filter((character) => character.trim().length > 0).length, 0);
    this.visitMarks = new Uint32Array(owners.length);
    this.neighbors = Array.from({ length: owners.length }, () => [] as number[]);
    for (let index = 0; index + 1 < adjacencyPairs.length; index += 2) {
      const a = adjacencyPairs[index];
      const b = adjacencyPairs[index + 1];
      if (a >= owners.length || b >= owners.length) continue;
      this.neighbors[a].push(b);
      this.neighbors[b].push(a);
    }
    for (const country of countries) this.countryById.set(country.id, country);
    for (let province = 1; province < owners.length; province += 1) {
      const countryId = owners[province];
      if (!countryId) continue;
      let provinces = this.provincesByCountry.get(countryId);
      if (!provinces) {
        provinces = new Set<number>();
        this.provincesByCountry.set(countryId, provinces);
      }
      provinces.add(province);
    }
    this.rebuildCountries(this.countryById.keys());
    this.rebuildInstances();
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
  }

  get renderData(): Float32Array { return this.instanceData; }

  get renderRevision(): number { return this.instanceRevision; }

  get visibleGlyphCount(): number {
    return this.visible ? this.instanceData.length / LABEL_GLYPH_STRIDE : 0;
  }

  get visibleLabelCount(): number {
    return this.visible ? this.glyphsByCountry.size : 0;
  }

  refreshOwnership(changes: CountryOwnershipChange[]): void {
    const affectedCountries = new Set<number>();
    for (const change of changes) {
      if (change.previousCountryId === change.countryId) continue;
      this.provincesByCountry.get(change.previousCountryId)?.delete(change.provinceId);
      let provinces = this.provincesByCountry.get(change.countryId);
      if (!provinces) {
        provinces = new Set<number>();
        this.provincesByCountry.set(change.countryId, provinces);
      }
      provinces.add(change.provinceId);
      affectedCountries.add(change.previousCountryId);
      affectedCountries.add(change.countryId);
    }
    if (!affectedCountries.size) return;
    this.rebuildCountries(affectedCountries);
    this.rebuildInstances();
  }

  private rebuildInstances(): void {
    const totalLength = [...this.glyphsByCountry.values()].reduce((sum, data) => sum + data.length, 0);
    const data = new Float32Array(totalLength);
    let cursor = 0;
    for (const country of this.countryById.values()) {
      const glyphs = this.glyphsByCountry.get(country.id);
      if (!glyphs) continue;
      data.set(glyphs, cursor);
      cursor += glyphs.length;
    }
    this.instanceData = data;
    this.instanceRevision += 1;
  }

  private rebuildCountries(countryIds: Iterable<number>): void {
    for (const countryId of countryIds) this.rebuildCountry(countryId);
  }

  private rebuildCountry(countryId: number): void {
    if (!countryId) return;
    const provinces = this.provincesByCountry.get(countryId);
    if (!provinces?.size) {
      this.anchors.delete(countryId);
      this.glyphsByCountry.delete(countryId);
      return;
    }
    this.visitEpoch = (this.visitEpoch + 1) >>> 0;
    if (this.visitEpoch === 0) {
      this.visitMarks.fill(0);
      this.visitEpoch = 1;
    }
    let largestComponent: number[] = [];
    let largestArea = -Infinity;
    for (const start of provinces) {
      if (this.visitMarks[start] === this.visitEpoch) continue;
      const component: number[] = [];
      let area = 0;
      const stack = [start];
      this.visitMarks[start] = this.visitEpoch;
      while (stack.length) {
        const province = stack.pop() as number;
        component.push(province);
        area += this.labelData[province * 3 + 2];
        for (const neighbor of this.neighbors[province]) {
          if (this.visitMarks[neighbor] !== this.visitEpoch && this.owners[neighbor] === countryId) {
            this.visitMarks[neighbor] = this.visitEpoch;
            stack.push(neighbor);
          }
        }
      }
      if (area > largestArea) {
        largestArea = area;
        largestComponent = component;
      }
    }
    const anchor = createCountryAnchor(countryId, largestComponent, this.labelData, this.worldWidth);
    const country = this.countryById.get(countryId);
    if (anchor && country) {
      const previous = this.anchors.get(countryId);
      if (previous && previous.axisX * anchor.axisX + previous.axisZ * anchor.axisZ < 0) {
        anchor.axisX *= -1;
        anchor.axisZ *= -1;
      }
      this.anchors.set(countryId, anchor);
      const candidates = this.countryLabelCandidates(anchor, largestComponent);
      const glyphs = layoutCountryLabelWithinTerritory(
        country.name,
        anchor,
        this.atlas,
        candidates,
        (x, z) => this.ownsPoint(countryId, x, z),
        this.territorySampleSpacing,
      );
      if (glyphs.length) {
        const placed = placeCountryLabelOnTerrain(
          glyphs,
          this.sampleHeight,
          this.heightSampleSpacing,
        );
        // c.w was reserved (always 0); stow the owning country id here so the
        // label shader can look up its diplomacy tint per glyph.
        for (let offset = 0; offset < placed.length; offset += LABEL_GLYPH_STRIDE) {
          placed[offset + 11] = countryId;
        }
        this.glyphsByCountry.set(countryId, placed);
      }
      else this.glyphsByCountry.delete(countryId);
    } else {
      this.anchors.delete(countryId);
      this.glyphsByCountry.delete(countryId);
    }
  }

  private countryLabelCandidates(anchor: CountryAnchor, component: number[]): Array<{ x: number; z: number }> {
    const candidates = [{ x: anchor.x, z: anchor.z }];
    const ranked = [...component].sort((provinceA, provinceB) => {
      const score = (province: number) => {
        const offset = province * 3;
        const rawDistanceX = Math.abs(this.labelData[offset] - anchor.x);
        const distanceX = Math.min(rawDistanceX, this.worldWidth - rawDistanceX);
        const distanceZ = this.labelData[offset + 1] - anchor.z;
        const centrality = Math.hypot(
          distanceX / Math.max(1, anchor.span),
          distanceZ / Math.max(1, anchor.crossSpan),
        );
        return centrality - Math.log2(this.labelData[offset + 2] + 1) * 0.015;
      };
      return score(provinceA) - score(provinceB);
    });
    for (const province of ranked.slice(0, 24)) {
      const offset = province * 3;
      const candidate = { x: this.labelData[offset], z: this.labelData[offset + 1] };
      if (!candidates.some((existing) => Math.hypot(existing.x - candidate.x, existing.z - candidate.z) < 1)) {
        candidates.push(candidate);
      }
    }
    return candidates;
  }
}
