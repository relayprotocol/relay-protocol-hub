import { db } from "../src/common/db";

import { chains } from "./common/chains";

// Setup
export default async () => {
  for (const chain of chains) {
    await db.oneOrNone(
      `
        INSERT INTO chains (
          id,
          vm_type,
          depository,
          metadata
        ) VALUES (
          $/id/,
          $/vmType/,
          $/depository/,
          $/metadata:json/
        ) ON CONFLICT DO NOTHING
      `,
      {
        id: chain.id,
        vmType: chain.vmType,
        depository: chain.depository,
        metadata: chain.metadata,
      }
    );
  }
};
