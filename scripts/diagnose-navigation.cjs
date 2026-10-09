/* Synthetic regression for the old 15 m GPS-crossing skip. No network or real location. */
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const box = { exports: {} };
  cache.set(file, box.exports);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('require', 'module', 'exports', code)(name => name.startsWith('.') ? load(path.resolve(path.dirname(file), `${name}.ts`)) : require(name), box, box.exports);
  return box.exports;
}
const { Journey } = load(path.join(__dirname, '../src/nav/journey.ts'));
const p = (east, north) => ({ latitude: -33.87 + north / 111195, longitude: 151.21 + east / (111195 * Math.cos(-33.87 * Math.PI / 180)) });
let now = 1000000;
const fix = (east, north) => ({ ...p(east, north), accuracy: 5, timestamp: now += 5000 });
const route = { destination: 'Synthetic destination', destinationAddress: 'Test only', points: [p(0, -40), p(0, 0), p(12, 0)], distanceMeters: 52, durationSeconds: 60, warnings: [], steps: [
  { instruction: 'Approach crossing', points: [p(0, -40), p(0, 0)], distanceMeters: 40, maneuver: 'DEPART' },
  { instruction: 'Cross test road', points: [p(0, 0), p(12, 0)], distanceMeters: 12, maneuver: 'STRAIGHT' },
] };
const journey = new Journey({ now: () => now, locate: async () => fix(0, -40), search: async () => [], route: async () => route,
  watch: async () => ({ remove() {} }), say() {}, silence() {} });
(async () => {
  await journey.select({ id: 'test', name: 'Test', address: 'Synthetic', point: p(12, 0) });
  await journey.start();
  const observations = [[0, -8], [13, 0], [13, 0], [0, -8]].map(([east, north]) => {
    journey.onFix(fix(east, north));
    return { east, north, instructionIndex: journey.state.value.stepIndex, remaining: journey.state.value.remaining };
  });
  console.log(JSON.stringify({ scenario: 'GPS jitter must not skip the crossing', observations }, null, 2));
  journey.end();
  if (observations.some(o => o.instructionIndex !== 0)) process.exitCode = 1;
})();
