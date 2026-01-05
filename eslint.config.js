const tseslint = require("@typescript-eslint/eslint-plugin");
const tsParser = require("@typescript-eslint/parser");
const pluginJsonc = require("eslint-plugin-jsonc");
const jsonParser = require("jsonc-eslint-parser");

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
  {
    files: ["src/**/*.ts", "src/**/*.tsx", "test/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: ["./tsconfig.eslint.json"],
        ecmaVersion: 2019,
        sourceType: "module",
      },
    },
    ignores: [],
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      ...tseslint.configs["recommended"].rules,
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-empty-interface": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-non-null-asserted-optional-chain": "off",
      "@typescript-eslint/switch-exhaustiveness-check": "off",
      "quotes": [
        "error",
        "double",
        {
          avoidEscape: true,
          allowTemplateLiterals: true,
        },
      ],
      "no-console": "error",
      "no-self-compare": "error",
    },
  },
  {
    files: ["**/package.json"],
    languageOptions: { parser: jsonParser },
    plugins: {
      "unevenlabs-policy": {
        rules: {
          "pinned-deps": require("./eslint-rules/pinned-deps.cjs"),
        },
      },
    },
    rules: {
      "unevenlabs-policy/pinned-deps": [
        "error",
        {
          excludeList: [
            "@berachain-foundation/berancer-sdk",
            "@nktkas/hyperliquid",
            "@solana-developers/helpers",
            "@solana/spl-token",
          ],
          internalScopes: ["@relay-vaults/"],
          allowProtocols: ["workspace:", "^workspace:"],
          allowProtocolsOnlyForInternal: true,
          allowExactPrerelease: true,
        },
      ],
    },
  },
];
