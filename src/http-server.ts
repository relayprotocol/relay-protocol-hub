import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import Fastify from "fastify";

import { setupEndpoints } from "./api";
import { logger } from "./common/logger";
import { config } from "./config";

const COMPONENT = "http-server";

const httpServer = Fastify().withTypeProvider<TypeBoxTypeProvider>();
setupEndpoints(httpServer);

httpServer.listen(
  {
    host: "0.0.0.0",
    port: config.httpPort,
  },
  (error) => {
    if (error) {
      logger.error(
        COMPONENT,
        JSON.stringify({
          msg: `Failed to start http server: ${error}`,
          stack: error?.stack,
        })
      );
      process.exit(1);
    }

    logger.info(COMPONENT, JSON.stringify({ msg: "Http server started" }));
  }
);
