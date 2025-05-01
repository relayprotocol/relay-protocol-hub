// Returns an error which can safely be exposed externally
export const externalError = (
  errorData: string | any,
  externalErrorCode?: string
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
