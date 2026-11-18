import { describe, expect, test } from "bun:test"
import { desktopLocationPath } from "./desktop-location-path"

describe("desktopLocationPath", () => {
  test("keeps login path and query from oc:// style locations", () => {
    expect(
      desktopLocationPath({
        pathname: "/login",
        search: "?redirect=%2Fcode",
        hash: "",
      }),
    ).toBe("/login?redirect=%2Fcode")
  })

  test("defaults empty pathname to /", () => {
    expect(desktopLocationPath({ pathname: "", search: "", hash: "" })).toBe("/")
  })
})
