import { describe, expect, test, beforeEach } from "bun:test"
import {
  getPrivateModelResource,
  listPrivateModelResources,
  listPrivateModels,
  resetPrivateModelsForTests,
  savePrivateModel,
} from "./private-assets"
import { capabilityCategories, getCapabilityResource } from "./catalog"

describe("private capability assets", () => {
  beforeEach(() => {
    resetPrivateModelsForTests()
  })

  test("saves private models as capability resources under domain", () => {
    const asset = savePrivateModel({
      name: "Internal MACE",
      blurb: "Team fine-tuned potential",
      tags: ["mlff", "界面"],
      domain: "materials",
    })
    expect(asset.id.startsWith("private_")).toBe(true)
    expect(listPrivateModels("materials").map((item) => item.id)).toEqual([asset.id])
    expect(listPrivateModels("weather")).toEqual([])

    const resource = getPrivateModelResource(asset.id)
    expect(resource?.ownership).toBe("private")
    expect(resource?.tags).toEqual(["私有", "mlff", "界面"])
    expect(getCapabilityResource(asset.id)?.name).toBe("Internal MACE")
    expect(
      capabilityCategories("materials")
        .find((category) => category.id === "onemodel")
        ?.items.some((item) => item.id === asset.id),
    ).toBe(true)
    expect(listPrivateModelResources("materials").some((item) => item.id === asset.id)).toBe(true)
  })
})
