// Returns an error which can safely be exposed externally
export const externalError = (message: string) => {
  const error = new Error(message);
  (error as any).isExternalError = true;
  return error;
};

export const isExternalError = (error: any) => {
  return Boolean(error.isExternalError);
};

// Returns an error which should not be exposed externally
export const internalError = (message: string) => {
  const error = new Error(message);
  (error as any).isInternalError = true;
  return error;
};

export const isInternalError = (error: any) => {
  return Boolean(error.isInternalError);
};
