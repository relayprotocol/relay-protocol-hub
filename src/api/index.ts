import { FastifyInstance } from "fastify";

import { Endpoint, errorWrapper } from "./utils";

const endpoints = [] as Endpoint[];

export const setupEndpoints = (app: FastifyInstance) => {
  endpoints.forEach((endpoint) =>
    app.route({
      ...endpoint,
      handler: errorWrapper(endpoint.url, endpoint.handler),
    })
  );
};
