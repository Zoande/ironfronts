const europe = process.env.MAP_KIND === 'europe';
export const WORLD_WIDTH = europe ? 5_935 : 13_562;
export const WORLD_HEIGHT = europe ? 3_950 : 7_000;
export const ID_WIDTH = 4_096;
export const ID_HEIGHT = Math.round(ID_WIDTH * WORLD_HEIGHT / WORLD_WIDTH);
export const FIELD_WIDTH = 2_048;
export const FIELD_HEIGHT = Math.round(FIELD_WIDTH * WORLD_HEIGHT / WORLD_WIDTH);
export const SEED = 0x49f2a631;
