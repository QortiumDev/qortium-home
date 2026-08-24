const generatedAndroidBuildEntry =
  /^\/node_modules\/(?:[^/]+\/)+android\/build(?:\/|$)/;

export function findForbiddenProductionEntry(entries) {
  return entries.find((entry) =>
    entry === '/dist/index.html' ||
    entry === '/dist-electron/v2-fixture-main.js' ||
    entry === '/dist-electron/.tsbuildinfo' ||
    /^\/dist-electron\/.*\.test\.js$/.test(entry) ||
    generatedAndroidBuildEntry.test(entry)
  );
}
