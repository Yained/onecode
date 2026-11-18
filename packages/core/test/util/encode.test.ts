import { describe, expect, test } from "bun:test"
import { base64Decode, base64Encode } from "../../src/util/encode"

describe("base64 workspace slug encoding", () => {
  test("roundtrips common workspace paths", () => {
    for (const path of ["/", "/data/zhzn1/case", "/data/work/my_proj", "D:\\code\\onecode", "/data/科研项目"]) {
      const slug = base64Encode(path)
      expect(base64Decode(slug)).toBe(path)
    }
  })

  test("rejects slug-like segments that are not encoded paths", () => {
    for (const slug of ["d-code", "onecode", "my-project", "session", "dev"]) {
      expect(() => base64Decode(slug)).toThrow("Invalid base64 workspace slug")
    }
  })
})
