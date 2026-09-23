// Keeps development files out of the packaged .xpi. Everything listed here is either
// repo furniture or test material — none of it ships to users or to AMO reviewers.
export default {
  ignoreFiles: [
    'test',
    'node_modules',
    'web-ext-artifacts',
    'package.json',
    'package-lock.json',
    'web-ext-config.mjs',
    'docs',
    '*.md',
  ],
  build: {
    overwriteDest: true,
  },
};
