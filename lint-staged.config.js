/* eslint-env commonjs */
module.exports = {
  "*.{ts,tsx}": ["eslint --fix", "prettier --parser typescript --write"],
  "*.{js,jsx}": ["eslint --fix", "prettier --write"],
  "*.{md,yaml,json}": ["prettier --write"],
};
