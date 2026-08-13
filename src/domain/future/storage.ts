export interface BinaryObjectMetadata {
  key: string;
  contentType: string;
  byteLength: number;
  checksumSha256: string;
}

export interface BinaryObjectDraft {
  key: string;
  contentType: string;
  bytes: Uint8Array;
  checksumSha256: string;
}

export interface BinaryObjectStore {
  put(draft: BinaryObjectDraft): Promise<BinaryObjectMetadata>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
}
