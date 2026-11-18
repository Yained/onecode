import { describe, expect, test } from "bun:test"
import { localizeSshConnectivityMessage } from "./ssh-connectivity"

describe("ssh connectivity messages", () => {
  test("explains when the OneCode host is missing ssh", () => {
    const message = localizeSshConnectivityMessage('Executable not found in $PATH: "ssh"')
    expect(message).toContain("PATH")
    expect(message).toContain("/usr/bin/ssh")
    expect(localizeSshConnectivityMessage("Connection refused")).toBe("Connection refused")
  })
})
