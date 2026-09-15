import type { CountryRecord } from '../rendering/types';

export interface CountryLabelGlyph {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  advanceAtMeasurementSize: number;
  widthAtMeasurementSize: number;
  heightAtMeasurementSize: number;
  inkWidthAtMeasurementSize: number;
  inkHeightAtMeasurementSize: number;
}

export const LABEL_MEASUREMENT_SIZE = 20;

const LABEL_FONT_FAMILY = '"Bitter"';
const LABEL_FONT_WEIGHT = 800;
const LABEL_LETTER_SPACING = 0.1;
const ATLAS_FONT_SIZE = 128;
const ATLAS_WIDTH = 2048;
const ATLAS_PADDING = 22;

export async function loadCountryLabelFont(): Promise<void> {
  if (!document.fonts) return;
  await document.fonts.load(`${LABEL_FONT_WEIGHT} ${ATLAS_FONT_SIZE}px ${LABEL_FONT_FAMILY}`);
  await document.fonts.ready;
}

export class CountryLabelAtlas {
  readonly canvas: HTMLCanvasElement;
  readonly lineHeightAtMeasurementSize: number;
  readonly trackingAtMeasurementSize = LABEL_MEASUREMENT_SIZE * LABEL_LETTER_SPACING;
  private readonly glyphs = new Map<string, CountryLabelGlyph>();
  private readonly advances = new Map<string, number>();
  private readonly context: CanvasRenderingContext2D;

  constructor(countries: CountryRecord[]) {
    this.canvas = document.createElement('canvas');
    const context = this.canvas.getContext('2d', { alpha: true });
    if (!context) throw new Error('Country labels require a 2D canvas context');
    this.context = context;
    this.lineHeightAtMeasurementSize = (ATLAS_FONT_SIZE * 1.35 + ATLAS_PADDING * 2)
      * LABEL_MEASUREMENT_SIZE / ATLAS_FONT_SIZE;
    this.build(countries);
  }

  getGlyph(character: string): CountryLabelGlyph | undefined {
    return this.glyphs.get(character);
  }

  getAdvance(character: string): number {
    return this.advances.get(character) ?? this.advances.get(' ') ?? LABEL_MEASUREMENT_SIZE * 0.5;
  }

  measureLabel(label: string): number {
    const characters = [...label.toLocaleUpperCase()];
    return characters.reduce((width, character, index) => width + this.getAdvance(character)
      + (index + 1 < characters.length ? this.trackingAtMeasurementSize : 0), 0);
  }

  private measureCharacter(character: string, fontSize: number): TextMetrics {
    this.context.font = `${LABEL_FONT_WEIGHT} ${fontSize}px ${LABEL_FONT_FAMILY}`;
    return this.context.measureText(character);
  }

  private build(countries: CountryRecord[]): void {
    const characters = new Set<string>([' ']);
    for (const country of countries) {
      for (const character of country.name.toLocaleUpperCase()) characters.add(character);
    }

    const placements: Array<{
      character: string; x: number; y: number; width: number; height: number; inkWidth: number; inkHeight: number;
    }> = [];
    let x = ATLAS_PADDING;
    let y = ATLAS_PADDING;
    let rowHeight = 0;
    const height = Math.ceil(ATLAS_FONT_SIZE * 1.35) + ATLAS_PADDING * 2;
    for (const character of characters) {
      const metrics = this.measureCharacter(character, ATLAS_FONT_SIZE);
      const advance = metrics.width;
      this.advances.set(character, advance * LABEL_MEASUREMENT_SIZE / ATLAS_FONT_SIZE);
      if (character.trim().length === 0) continue;
      const width = Math.ceil(advance) + ATLAS_PADDING * 2;
      const outlineAndShadow = ATLAS_FONT_SIZE * 0.16;
      const inkWidth = Math.max(1, metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight) + outlineAndShadow;
      const inkHeight = Math.max(1, metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent) + outlineAndShadow;
      if (x + width + ATLAS_PADDING > ATLAS_WIDTH) {
        x = ATLAS_PADDING;
        y += rowHeight;
        rowHeight = 0;
      }
      placements.push({ character, x, y, width, height, inkWidth, inkHeight });
      x += width;
      rowHeight = Math.max(rowHeight, height);
    }

    this.canvas.width = ATLAS_WIDTH;
    this.canvas.height = nextPowerOfTwo(Math.max(1, y + rowHeight + ATLAS_PADDING));
    const context = this.canvas.getContext('2d', { alpha: true });
    if (!context) throw new Error('Country label atlas context was lost');
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.lineJoin = 'round';
    context.miterLimit = 2;
    context.font = `${LABEL_FONT_WEIGHT} ${ATLAS_FONT_SIZE}px ${LABEL_FONT_FAMILY}`;
    context.lineWidth = ATLAS_FONT_SIZE * 0.095;
    context.fillStyle = 'rgba(246, 243, 224, 0.97)';
    context.strokeStyle = 'rgba(24, 27, 27, 0.94)';
    context.shadowColor = 'rgba(4, 8, 8, 0.42)';
    context.shadowBlur = ATLAS_FONT_SIZE * 0.025;
    context.shadowOffsetX = ATLAS_FONT_SIZE * 0.025;
    context.shadowOffsetY = ATLAS_FONT_SIZE * 0.035;
    for (const placement of placements) {
      const centerX = placement.x + placement.width * 0.5;
      const centerY = placement.y + placement.height * 0.5;
      context.strokeText(placement.character, centerX, centerY);
      context.fillText(placement.character, centerX, centerY);
      this.glyphs.set(placement.character, {
        u0: placement.x / this.canvas.width,
        v0: placement.y / this.canvas.height,
        u1: (placement.x + placement.width) / this.canvas.width,
        v1: (placement.y + placement.height) / this.canvas.height,
        advanceAtMeasurementSize: this.getAdvance(placement.character),
        widthAtMeasurementSize: placement.width * LABEL_MEASUREMENT_SIZE / ATLAS_FONT_SIZE,
        heightAtMeasurementSize: placement.height * LABEL_MEASUREMENT_SIZE / ATLAS_FONT_SIZE,
        inkWidthAtMeasurementSize: placement.inkWidth * LABEL_MEASUREMENT_SIZE / ATLAS_FONT_SIZE,
        inkHeightAtMeasurementSize: placement.inkHeight * LABEL_MEASUREMENT_SIZE / ATLAS_FONT_SIZE,
      });
    }
  }
}

function nextPowerOfTwo(value: number): number {
  return 2 ** Math.ceil(Math.log2(Math.max(1, value)));
}
