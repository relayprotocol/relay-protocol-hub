import { Signer } from '@aws-sdk/rds-signer';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';

interface GetIamTokenParams {
  host: string;
  port?: number;
  user: string;
  region?: string;
}

export const getIamToken = async({
  host,
  port = 5432,
  user,
  region = 'us-east-1',
}: GetIamTokenParams) => {
  const signer = new Signer({
    hostname: host,
    port,
    username: user,
    region,
    credentials: fromNodeProviderChain()
  });

  return signer.getAuthToken();
}
