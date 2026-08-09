/** Minimalny stub dla testów HTTP USOS w Node (bez Metro). */
export const Platform = { OS: 'node', select: (options) => options.node ?? options.default };
export const NativeModules = {};
export default { Platform, NativeModules };
