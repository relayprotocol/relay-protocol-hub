## Relay Hub

> #### Reference implementation of a Relay protocol hub

See [overview](./docs/overview.md) for in-depth documentation on how the hub works

### Installation

#### Prerequisites

All infrastructure components required to run the service and tests are available via `docker`, these must be up and running before starting the service or running the tests:

```bash
docker compose up
```

#### Testing

Run the tests via:

```bash
yarn test
```

#### Running the service

Before starting the service, make sure to have the required environment variables configured (check the [`.env.example`](./.env.example) file for all required and optional configuration variables).

Start the service via:

```bash
yarn start
```
