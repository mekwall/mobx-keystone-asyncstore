/* eslint-env commonjs */
module.exports = {
  "*.{ts,tsx}": [
    "eslint --fix",
    "prettier --parser typescript --write",
    "git add",
    // "jest --bail --findRelatedTests",
  ],
  "*.{js,jsx}": ["eslint --fix", "prettier --write", "git add"],
  "*.{md,yaml,json}": ["prettier --write", "git add"],
};
