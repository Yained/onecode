import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  capabilityCatalogHref,
  clearStoredCapabilitySelection,
  readStoredCapabilitySelection,
  selectionFromCapabilityLocation,
  writeStoredCapabilitySelection,
} from "./selection"

const memory = new Map<string, string>()
const originalLocalStorage = globalThis.localStorage

const memoryStorage: Storage = {
  get length() {
    return memory.size
  },
  clear() {
    memory.clear()
  },
  getItem(key: string) {
    return memory.get(key) ?? null
  },
  key(index: number) {
    return [...memory.keys()][index] ?? null
  },
  removeItem(key: string) {
    memory.delete(key)
  },
  setItem(key: string, value: string) {
    memory.set(key, String(value))
  },
}

beforeEach(() => {
  memory.clear()
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: memoryStorage,
  })
  clearStoredCapabilitySelection()
})

afterEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: originalLocalStorage,
  })
})

describe("capability catalog selection", () => {
  test("empty catalog path defaults to 全部 instead of 材料", () => {
    expect(selectionFromCapabilityLocation("/workspace/capabilities", "")).toEqual({
      categoryId: "scenario",
      domainId: "all",
    })
    expect(capabilityCatalogHref()).toBe("/workspace/capabilities?category=scenario&domain=all")
  })

  test("restores last domain after leaving for skills settings", () => {
    writeStoredCapabilitySelection({ categoryId: "scenario", domainId: "all" })
    expect(selectionFromCapabilityLocation("/workspace/capabilities", "")).toEqual({
      categoryId: "scenario",
      domainId: "all",
    })
    expect(capabilityCatalogHref()).toBe("/workspace/capabilities?category=scenario&domain=all")

    writeStoredCapabilitySelection({ categoryId: "onemodel", domainId: "weather" })
    expect(selectionFromCapabilityLocation("/workspace/capabilities", "")).toEqual({
      categoryId: "onemodel",
      domainId: "weather",
    })
    expect(capabilityCatalogHref()).toBe("/workspace/capabilities?category=onemodel&domain=weather")
  })

  test("oneskills without domain keeps the stored domain tab", () => {
    writeStoredCapabilitySelection({ categoryId: "scenario", domainId: "materials" })
    expect(selectionFromCapabilityLocation("/workspace/capabilities", "?category=oneskills")).toEqual({
      categoryId: "oneskills",
      domainId: "materials",
    })
    expect(selectionFromCapabilityLocation("/workspace/capabilities", "?category=oneskills&domain=all")).toEqual({
      categoryId: "oneskills",
      domainId: "all",
    })
  })

  test("explicit query wins over stored selection", () => {
    writeStoredCapabilitySelection({ categoryId: "hpc", domainId: "bio" })
    expect(selectionFromCapabilityLocation("/workspace/capabilities", "?category=scenario&domain=all")).toEqual({
      categoryId: "scenario",
      domainId: "all",
    })
    expect(readStoredCapabilitySelection()).toEqual({ categoryId: "hpc", domainId: "bio" })
  })
})
