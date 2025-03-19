export type DbEntry<T> = T & {
  createdAt: Date;
  updatedAt: Date;
};
