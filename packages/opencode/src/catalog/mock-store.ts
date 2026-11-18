import * as BlobStore from "./blob-store"

export const mockBlobPath = BlobStore.primitiveBlobPath
export const writeMockBlob = BlobStore.writePrimitiveBlob
export const readMockBlob = BlobStore.readPrimitiveBlob
export const ensureMockLocation = BlobStore.ensureBlobLocation
export const blobLocationRef = BlobStore.blobLocationRef
export const CatalogBlobStore = BlobStore.CatalogBlobStore

export const CatalogMockStore = {
  mockBlobPath: BlobStore.primitiveBlobPath,
  writeMockBlob: BlobStore.writePrimitiveBlob,
  readMockBlob: BlobStore.readPrimitiveBlob,
  ensureMockLocation: BlobStore.ensureBlobLocation,
  blobLocationRef: BlobStore.blobLocationRef,
}
