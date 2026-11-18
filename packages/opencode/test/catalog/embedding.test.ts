import { describe, expect, test } from "bun:test"
import { CatalogEmbedding } from "@/catalog/embedding"

describe("CatalogEmbedding", () => {
  test("produces normalized local vectors", () => {
    const vector = CatalogEmbedding.embedTextLocal("weather forecast workflow")
    expect(vector.length).toBe(CatalogEmbedding.LOCAL_EMBED_DIMS)
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
    expect(norm).toBeCloseTo(1, 5)
  })

  test("similar text has higher cosine similarity than unrelated text", () => {
    const left = CatalogEmbedding.embedTextLocal("remote workflow orchestration for earth science")
    const near = CatalogEmbedding.embedTextLocal("earth science workflow orchestration remote")
    const far = CatalogEmbedding.embedTextLocal("protein folding structure prediction")
    expect(CatalogEmbedding.cosineSimilarity(left, near)).toBeGreaterThan(
      CatalogEmbedding.cosineSimilarity(left, far),
    )
  })

  test("detects stale embeddings from source hash changes", () => {
    const row = {
      embedding_json: [1, 0, 0],
      embedding_model: CatalogEmbedding.LOCAL_MODEL_ID,
      embedding_source_hash: "old-hash",
    }
    const model = CatalogEmbedding.resolveEmbedModel("local")!
    expect(CatalogEmbedding.needsEmbedding(row as never, "updated text", model)).toBe(true)
  })

  test("model mode resolves local onnx embedding", () => {
    const model = CatalogEmbedding.resolveEmbedModel("model")
    expect(model?.mode).toBe("model")
    expect(model?.id).toBe(CatalogEmbedding.DEFAULT_ONNX_MODEL)
  })

  test("resolveEmbedModelById maps onnx model ids", () => {
    const model = CatalogEmbedding.resolveEmbedModelById(CatalogEmbedding.DEFAULT_ONNX_MODEL)
    expect(model?.mode).toBe("model")
    expect(model?.dims).toBe(CatalogEmbedding.DEFAULT_ONNX_DIMS)
  })
})
