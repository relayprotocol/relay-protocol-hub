/**
 * For a detailed explanation regarding each configuration property, visit:
 * https://jestjs.io/docs/configuration
 */

import type { Config } from "jest";

const config: Config = {
  verbose: true,
  transform: {
    "^.+\\.ts?$": "ts-jest",
  },
  globalSetup: "./test/setup.ts",
  testTimeout: 30_000,
};

export default config;
