// The one map look, shared by every map in the app.
//
// Two maps draw a bus now: the passenger's route map (MOV-119) and the driver's
// vehicle dashboard map (MOV-262). They show different things — a whole journey
// against a single vehicle — but they must draw the same world and mark a bus
// the same way, or the two halves of the product look like two products.
//
// Only values live here. No react-native-maps import, so this file is safe on
// every platform, including the web bundle where that library cannot load.

/**
 * OpenStreetMap's standard tile server.
 *
 * Its usage policy asks for light, non-bulk use. Both callers are well within
 * that: a passenger opens one journey map on demand, and a driver's dashboard
 * map draws one vehicle while a shift is running.
 */
export const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

export const OSM_MAX_ZOOM = 19;

/**
 * The colour reserved for a bus, and for nothing else.
 *
 * Colour is the least of what identifies it: on both maps the vehicle is the
 * only round badge and the only marker carrying a vehicle glyph, so it stays
 * distinguishable without relying on colour vision.
 */
export const VEHICLE_MARKER_COLOR = '#047857';
