import type { GameLobby, LobbyCountry } from '@ironfronts/protocol';
import { MIN_STARTING_CITIES, selectableCountries } from './lobby-state';

export const CAMPAIGN_MAP_WIDTH = 1_024;
export let CAMPAIGN_MAP_HEIGHT = 529;

const COLORS = {
  ocean: [21, 27, 26, 255],
  border: [45, 45, 38, 255],
  available: [218, 207, 181, 255],
  unavailable: [92, 95, 91, 255],
  selected: [81, 124, 68, 255],
} as const;

export interface CampaignMapStatus {
  readonly country: LobbyCountry | null;
  readonly message: string;
}

export interface CampaignMapController {
  readonly ready: Promise<void>;
  setSelection(countryId: number | null): void;
  focus(): void;
  dispose(): void;
}

interface MapRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Zoom + pan window into the country raster. `zoom` 1 = whole map. */
export interface MapView {
  readonly zoom: number;
  readonly originX: number;
  readonly originY: number;
}

const FULL_VIEW: MapView = { zoom: 1, originX: 0, originY: 0 };
export const MAX_MAP_ZOOM = 6;

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

/**
 * Translate a pointer into the country raster's pixel space. The canvas uses
 * `object-fit: contain`, so its bitmap may be letterboxed inside the element;
 * those insets must be removed before scaling or edge clicks select a country
 * offset from the one under the pointer. `view` folds in the zoom + pan
 * window; omitted, it resolves against the whole map (zoom 1).
 */
export function campaignMapCoordinates(
  clientX: number, clientY: number, rect: MapRect, view: MapView = FULL_VIEW,
): readonly [number, number] | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  const mapAspect = CAMPAIGN_MAP_WIDTH / CAMPAIGN_MAP_HEIGHT;
  const rectAspect = rect.width / rect.height;
  const displayWidth = rectAspect > mapAspect ? rect.height * mapAspect : rect.width;
  const displayHeight = rectAspect > mapAspect ? rect.height : rect.width / mapAspect;
  const displayLeft = rect.left + (rect.width - displayWidth) / 2;
  const displayTop = rect.top + (rect.height - displayHeight) / 2;
  if (clientX < displayLeft || clientX >= displayLeft + displayWidth
    || clientY < displayTop || clientY >= displayTop + displayHeight) return null;
  const windowWidth = CAMPAIGN_MAP_WIDTH / view.zoom;
  const windowHeight = CAMPAIGN_MAP_HEIGHT / view.zoom;
  const fractionX = (clientX - displayLeft) / displayWidth;
  const fractionY = (clientY - displayTop) / displayHeight;
  return [
    clamp(Math.floor(view.originX + fractionX * windowWidth), 0, CAMPAIGN_MAP_WIDTH - 1),
    clamp(Math.floor(view.originY + fractionY * windowHeight), 0, CAMPAIGN_MAP_HEIGHT - 1),
  ];
}

function unavailableReason(country: LobbyCountry): string {
  if (!country.alive) return `${country.name} · No controlled territory · Unavailable`;
  if (country.claimed) return `${country.name} · Already claimed · Unavailable`;
  return `${country.name} · ${country.startingCities}/${MIN_STARTING_CITIES} starting cities · Unavailable`;
}

export function mountCampaignMap(
  canvas: HTMLCanvasElement,
  lobby: GameLobby,
  onSelect: (country: LobbyCountry) => void,
  onStatus: (status: CampaignMapStatus) => void,
): CampaignMapController {
  const europe = lobby.gameId === 'europe-at-war-1';
  CAMPAIGN_MAP_HEIGHT = europe ? 682 : 529;
  const mapUrl = europe ? '/menu/campaign-europe-ids.u16' : '/menu/campaign-country-ids.u16';
  canvas.width = CAMPAIGN_MAP_WIDTH;
  canvas.height = CAMPAIGN_MAP_HEIGHT;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Campaign map canvas is unavailable.');
  const listeners = new AbortController();
  const countriesById = new Map(lobby.countries.map((country) => [country.id, country]));
  const playable = selectableCountries(lobby);
  const playableIds = new Set(playable.map((country) => country.id));
  let ids: Uint16Array | null = null;
  let selectedCountryId: number | null = null;

  // Zoom + pan window into the raster. zoom 1 = whole map; origin is the
  // top-left raster pixel currently shown. All pointer math folds this in via
  // `campaignMapCoordinates(..., view)`.
  const view = { zoom: 1, originX: 0, originY: 0 };
  const windowSize = (): readonly [number, number] =>
    [CAMPAIGN_MAP_WIDTH / view.zoom, CAMPAIGN_MAP_HEIGHT / view.zoom];
  const clampOrigin = (): void => {
    const [winW, winH] = windowSize();
    view.originX = clamp(view.originX, 0, CAMPAIGN_MAP_WIDTH - winW);
    view.originY = clamp(view.originY, 0, CAMPAIGN_MAP_HEIGHT - winH);
  };
  const displayBox = (rect: MapRect): MapRect => {
    const mapAspect = CAMPAIGN_MAP_WIDTH / CAMPAIGN_MAP_HEIGHT;
    const rectAspect = rect.width / rect.height;
    const width = rectAspect > mapAspect ? rect.height * mapAspect : rect.width;
    const height = rectAspect > mapAspect ? rect.height : rect.width / mapAspect;
    return { left: rect.left + (rect.width - width) / 2, top: rect.top + (rect.height - height) / 2, width, height };
  };

  // Colour for one raster pixel: ocean, an anti-aliasable boundary (any of the
  // four neighbours belongs to a different country), or the fill for its state.
  const colorAt = (rx: number, ry: number): readonly number[] => {
    const index = ry * CAMPAIGN_MAP_WIDTH + rx;
    const id = ids![index];
    if (id === 0) return COLORS.ocean;
    const boundary = (rx > 0 && ids![index - 1] !== id)
      || (rx < CAMPAIGN_MAP_WIDTH - 1 && ids![index + 1] !== id)
      || (ry > 0 && ids![index - CAMPAIGN_MAP_WIDTH] !== id)
      || (ry < CAMPAIGN_MAP_HEIGHT - 1 && ids![index + CAMPAIGN_MAP_WIDTH] !== id);
    if (boundary) return COLORS.border;
    return id === selectedCountryId
      ? COLORS.selected
      : playableIds.has(id) ? COLORS.available : COLORS.unavailable;
  };

  const draw = (): void => {
    if (!ids) return;
    const image = context.createImageData(CAMPAIGN_MAP_WIDTH, CAMPAIGN_MAP_HEIGHT);
    const [winW, winH] = windowSize();
    // Nearest-neighbour sampling stair-steps borders once zoomed in. Above 1x,
    // average an NxN grid of sub-samples per pixel so coastlines and country
    // edges anti-alias instead of turning blocky.
    const grid = view.zoom > 1.05 ? 3 : 1;
    const inv = 1 / grid;
    const n = grid * grid;
    for (let cy = 0; cy < CAMPAIGN_MAP_HEIGHT; cy += 1) {
      for (let cx = 0; cx < CAMPAIGN_MAP_WIDTH; cx += 1) {
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        for (let sy = 0; sy < grid; sy += 1) {
          const fy = (cy + (sy + 0.5) * inv) / CAMPAIGN_MAP_HEIGHT;
          const ry = Math.min(CAMPAIGN_MAP_HEIGHT - 1, Math.floor(view.originY + fy * winH));
          for (let sx = 0; sx < grid; sx += 1) {
            const fx = (cx + (sx + 0.5) * inv) / CAMPAIGN_MAP_WIDTH;
            const rx = Math.min(CAMPAIGN_MAP_WIDTH - 1, Math.floor(view.originX + fx * winW));
            const c = colorAt(rx, ry);
            r += c[0]; g += c[1]; b += c[2]; a += c[3];
          }
        }
        const o = (cy * CAMPAIGN_MAP_WIDTH + cx) * 4;
        image.data[o] = r / n;
        image.data[o + 1] = g / n;
        image.data[o + 2] = b / n;
        image.data[o + 3] = a / n;
      }
    }
    context.putImageData(image, 0, 0);
  };

  // Inner client box of the canvas, with the decorative border removed —
  // `object-fit: contain` and every pointer mapping work off this box.
  const innerRect = (): MapRect => {
    const rect = canvas.getBoundingClientRect();
    return {
      left: rect.left + canvas.clientLeft,
      top: rect.top + canvas.clientTop,
      width: canvas.clientWidth,
      height: canvas.clientHeight,
    };
  };

  const countryAt = (event: PointerEvent | MouseEvent): LobbyCountry | null => {
    if (!ids) return null;
    const point = campaignMapCoordinates(event.clientX, event.clientY, innerRect(), view);
    if (!point) return null;
    const [x, y] = point;
    return countriesById.get(ids[y * CAMPAIGN_MAP_WIDTH + x]) ?? null;
  };

  // --- zoom + pan -----------------------------------------------------------
  let drag: { x: number; y: number; moved: boolean } | null = null;

  canvas.addEventListener('wheel', (event) => {
    if (!ids) return;
    event.preventDefault();
    const box = displayBox(innerRect());
    const fx = clamp((event.clientX - box.left) / box.width, 0, 1);
    const fy = clamp((event.clientY - box.top) / box.height, 0, 1);
    const [winW, winH] = windowSize();
    const worldX = view.originX + fx * winW;
    const worldY = view.originY + fy * winH;
    const factor = event.deltaY < 0 ? 1.2 : 1 / 1.2;
    view.zoom = clamp(view.zoom * factor, 1, MAX_MAP_ZOOM);
    const [nextW, nextH] = windowSize();
    view.originX = view.zoom === 1 ? 0 : worldX - fx * nextW;
    view.originY = view.zoom === 1 ? 0 : worldY - fy * nextH;
    clampOrigin();
    draw();
  }, { passive: false, signal: listeners.signal });

  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !ids) return;
    drag = { x: event.clientX, y: event.clientY, moved: false };
    try { canvas.setPointerCapture(event.pointerId); } catch { /* not fatal */ }
  }, { signal: listeners.signal });
  const endDrag = (event: PointerEvent): void => {
    if (!drag) return;
    try { canvas.releasePointerCapture(event.pointerId); } catch { /* already released */ }
    // Keep `drag` alive through the click that fires right after pointerup so
    // the click handler can tell a pan from a select; clear it next tick.
    setTimeout(() => { drag = null; }, 0);
  };
  canvas.addEventListener('pointerup', endDrag, { signal: listeners.signal });
  canvas.addEventListener('pointercancel', endDrag, { signal: listeners.signal });

  canvas.addEventListener('pointermove', (event) => {
    if (drag) {
      const box = displayBox(innerRect());
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      drag.x = event.clientX;
      drag.y = event.clientY;
      const [winW, winH] = windowSize();
      view.originX -= (dx / box.width) * winW;
      view.originY -= (dy / box.height) * winH;
      clampOrigin();
      draw();
      canvas.style.cursor = 'grabbing';
      return;
    }
    const country = countryAt(event);
    canvas.style.cursor = country && playableIds.has(country.id)
      ? 'pointer'
      : view.zoom > 1 ? 'grab' : 'not-allowed';
    onStatus({
      country,
      message: !country ? 'Scroll to zoom, drag to pan. Move over a country to inspect it.'
        : playableIds.has(country.id)
          ? `${country.name} · ${country.startingCities} starting cities · Available`
          : unavailableReason(country),
    });
  }, { signal: listeners.signal });
  canvas.addEventListener('pointerleave', () => {
    canvas.style.cursor = '';
    onStatus({ country: null, message: 'Select a beige country. Grey countries cannot be claimed.' });
  }, { signal: listeners.signal });
  canvas.addEventListener('click', (event) => {
    if (drag?.moved) return; // a pan, not a pick
    const country = countryAt(event);
    if (!country || !playableIds.has(country.id)) return;
    selectedCountryId = country.id;
    draw();
    onSelect(country);
  }, { signal: listeners.signal });
  canvas.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) || !playable.length) return;
    event.preventDefault();
    const current = playable.findIndex((country) => country.id === selectedCountryId);
    const direction = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
    const next = playable[(current + direction + playable.length) % playable.length];
    selectedCountryId = next.id;
    draw();
    onSelect(next);
  }, { signal: listeners.signal });

  const ready = fetch(mapUrl)
    .then((response) => {
      if (!response.ok) throw new Error(`Campaign map failed to load (${response.status}).`);
      return response.arrayBuffer();
    })
    .then((buffer) => {
      if (buffer.byteLength !== CAMPAIGN_MAP_WIDTH * CAMPAIGN_MAP_HEIGHT * Uint16Array.BYTES_PER_ELEMENT) {
        throw new Error('Campaign map data has an unexpected size.');
      }
      if (!listeners.signal.aborted) { ids = new Uint16Array(buffer); draw(); }
    });

  return {
    ready,
    setSelection(countryId) { selectedCountryId = countryId; draw(); },
    focus() { canvas.focus(); },
    dispose() { listeners.abort(); },
  };
}
