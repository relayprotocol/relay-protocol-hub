const tseslint = require("@typescript-eslint/eslint-plugin");
const tsParser = require("@typescript-eslint/parser");
const pluginJsonc = require("eslint-plugin-jsonc");
const jsonParser = require("jsonc-eslint-parser");
const jsonDependencies = require("eslint-plugin-package-json-dependencies");

module.exports = [
  {
    files: ["**/*.json"],
    languageOptions: {
      parser: jsonParser,
    },
    plugins: {
      jsonc: pluginJsonc,
    },
    rules: {
      "jsonc/no-dupe-keys": "error",
    },
  },
  // {
  //   files: ["**/*.ts", "**/*.tsx"],
  //   languageOptions: {
  //     parser: tsParser,
  //     parserOptions: {
  //       project: ["./tsconfig.eslint.json"],
  //       ecmaVersion: 2019,
  //       sourceType: "module",
  //     },
  //   },
  //   ignores: [],
  //   plugins: {
  //     "@typescript-eslint": tseslint,
  //   },
  //   rules: {
  //     ...tseslint.configs["recommended"].rules,
  //     "@typescript-eslint/no-non-null-assertion": "off",
  //     "@typescript-eslint/no-empty-interface": "off",
  //     "@typescript-eslint/no-unused-vars": "off",
  //     "@typescript-eslint/no-explicit-any": "off",
  //     "@typescript-eslint/ban-ts-comment": "off",
  //     "@typescript-eslint/no-non-null-asserted-optional-chain": "off",
  //     "@typescript-eslint/switch-exhaustiveness-check": "off",
  //     "quotes": [
  //       "error",
  //       "double",
  //       {
  //         avoidEscape: true,
  //         allowTemplateLiterals: true,
  //       },
  //     ],
  //     "no-console": "error",
  //     "no-self-compare": "error",
  //   },
  // },
  // {
  //   files: ["**/*.spec.ts"],
  //   rules: {
  //     "no-console": "off",
  //   },
  // },
  {
    files: ["**/package.json"],
    plugins: {
      "package-json-deps": jsonDependencies,
    },
    languageOptions: {
      parser: jsonParser,
    },
    rules: {
      "package-json-deps/controlled-versions": ["error", { granularity: "patch" }],
    },
  },
];
