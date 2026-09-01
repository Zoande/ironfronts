import type { GameLobby, LobbyCountry } from '@ironfronts/protocol';
import { MIN_STARTING_CITIES, selectableCountries } from './lobby-state';

export const CAMPAIGN_MAP_WIDTH = 1_024;
export const CAMPAIGN_MAP_HEIGHT = 529;
const MAP_URL = '/menu/campaign-country-ids.u16';

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
}

interface MapRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Translate a pointer into the country raster's pixel space. The canvas uses
 * `object-fit: contain`, so its bitmap may be letterboxed inside the element;
 * those insets must be removed before scaling or edge clicks select a country
 * offset from the one under the pointer.
 */
export function campaignMapCoordinates(
  clientX: number, clientY: number, rect: MapRect,
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
  return [
    Math.min(CAMPAIGN_MAP_WIDTH - 1, Math.floor((clientX - displayLeft) / displayWidth * CAMPAIGN_MAP_WIDTH)),
    Math.min(CAMPAIGN_MAP_HEIGHT - 1, Math.floor((clientY - displayTop) / displayHeight * CAMPAIGN_MAP_HEIGHT)),
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
  canvas.width = CAMPAIGN_MAP_WIDTH;
  canvas.height = CAMPAIGN_MAP_HEIGHT;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Campaign map canvas is unavailable.');
  const countriesById = new Map(lobby.countries.map((country) => [country.id, country]));
  const playable = selectableCountries(lobby);
  const playableIds = new Set(playable.map((country) => country.id));
  let ids: Uint16Array | null = null;
  let selectedCountryId: number | null = null;

  const draw = (): void => {
    if (!ids) return;
    const image = context.createImageData(CAMPAIGN_MAP_WIDTH, CAMPAIGN_MAP_HEIGHT);
    for (let y = 0; y < CAMPAIGN_MAP_HEIGHT; y += 1) {
      for (let x = 0; x < CAMPAIGN_MAP_WIDTH; x += 1) {
        const index = y * CAMPAIGN_MAP_WIDTH + x;
        const id = ids[index];
        const boundary = id > 0 && (
          (x > 0 && ids[index - 1] !== id)
          || (y > 0 && ids[index - CAMPAIGN_MAP_WIDTH] !== id)
        );
        const color = id === 0
          ? COLORS.ocean
          : boundary
            ? COLORS.border
            : id === selectedCountryId
              ? COLORS.selected
              : playableIds.has(id) ? COLORS.available : COLORS.unavailable;
        image.data.set(color, index * 4);
      }
    }
    context.putImageData(image, 0, 0);
  };

  const countryAt = (event: PointerEvent | MouseEvent): LobbyCountry | null => {
    if (!ids) return null;
    const rect = canvas.getBoundingClientRect();
    // getBoundingClientRect includes the decorative border; object-fit uses the
    // inner client box. Exclude it so even narrow border countries stay exact.
    const point = campaignMapCoordinates(event.clientX, event.clientY, {
      left: rect.left + canvas.clientLeft,
      top: rect.top + canvas.clientTop,
      width: canvas.clientWidth,
      height: canvas.clientHeight,
    });
    if (!point) return null;
    const [x, y] = point;
    return countriesById.get(ids[y * CAMPAIGN_MAP_WIDTH + x]) ?? null;
  };

  canvas.addEventListener('pointermove', (event) => {
    const country = countryAt(event);
    canvas.style.cursor = country && playableIds.has(country.id) ? 'pointer' : 'not-allowed';
    onStatus({
      country,
      message: !country ? 'Move over a country to inspect it.'
        : playableIds.has(country.id)
          ? `${country.name} · ${country.startingCities} starting cities · Available`
          : unavailableReason(country),
    });
  });
  canvas.addEventListener('pointerleave', () => {
    canvas.style.cursor = '';
    onStatus({ country: null, message: 'Select a beige country. Grey countries cannot be claimed.' });
  });
  canvas.addEventListener('click', (event) => {
    const country = countryAt(event);
    if (!country || !playableIds.has(country.id)) return;
    selectedCountryId = country.id;
    draw();
    onSelect(country);
  });
  canvas.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) || !playable.length) return;
    event.preventDefault();
    const current = playable.findIndex((country) => country.id === selectedCountryId);
    const direction = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
    const next = playable[(current + direction + playable.length) % playable.length];
    selectedCountryId = next.id;
    draw();
    onSelect(next);
  });

  const ready = fetch(MAP_URL)
    .then((response) => {
      if (!response.ok) throw new Error(`Campaign map failed to load (${response.status}).`);
      return response.arrayBuffer();
    })
    .then((buffer) => {
      if (buffer.byteLength !== CAMPAIGN_MAP_WIDTH * CAMPAIGN_MAP_HEIGHT * Uint16Array.BYTES_PER_ELEMENT) {
        throw new Error('Campaign map data has an unexpected size.');
      }
      ids = new Uint16Array(buffer);
      draw();
    });

  return {
    ready,
    setSelection(countryId) { selectedCountryId = countryId; draw(); },
    focus() { canvas.focus(); },
  };
}
