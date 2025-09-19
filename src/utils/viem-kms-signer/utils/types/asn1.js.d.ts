declare module "asn1.js" {
  import { Buffer } from "buffer";

  interface ASN1Model<T = any> {
    encode(input: T, format: "der"): Buffer;
    decode(input: Buffer, format: "der"): T;
  }

  function define<T>(name: string, body: (this: any) => void): ASN1Model<T>;

  export { define };
}
