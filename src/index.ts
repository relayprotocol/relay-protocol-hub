import "./monkey-patches";

// Initialize http and ws servers
import "./http-server";

import { logger } from "./common/logger";

const COMPONENT = "process";

// Log unhandled errors
process.on("unhandledRejection", (error: any) => {
  logger.error(
    COMPONENT,
    JSON.stringify({
      msg: "Unhandled rejection",
      error,
      stack: error?.stack,
    })
  );
});
process.on("uncaughtException", (error: any) => {
  logger.error(
    COMPONENT,
    JSON.stringify({
      msg: "Uncaught exception",
      error,
      stack: error?.stack,
    })
  );
});
