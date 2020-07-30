/* eslint-env commonjs */
module.exports = {
  hooks: {
    "post-commit": "git update-index --again",
    "pre-commit": "yarn lint-staged",
    "pre-push": "yarn test && yarn validate",
    "commit-msg": "commitlint --env HUSKY_GIT_PARAMS",
  },
};
