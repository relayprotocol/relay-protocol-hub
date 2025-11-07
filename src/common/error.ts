type ErrorCode =
  | "DUPLICATE_ORACLE"
  | "INVALID_SIGNATURE"
  | "INSUFFICIENT_SIGNATURES"
  | "UNAUTHORIZED_ORACLE"
  | "UNSUPPORTED_SIGNATURE"
  | "NONCE_MAPPING_ALREADY_EXISTS"
  | "NONCE_MAPPING_NOT_FOUND";

// Returns an error which can safely be exposed externally
export const externalError = (
  errorData: string | any,
  externalErrorCode?: ErrorCode
) => {
  const error = errorData instanceof Error ? errorData : new Error(errorData);
  (error as any).isExternalError = true;
  (error as any).externalErrorCode = externalErrorCode;
  return error;
};

export const isExternalError = (error: any) => {
  return Boolean(error.isExternalError);
};

export const isInternalError = (error: any) => {
  return Boolean(!error.isExternalError);
};
