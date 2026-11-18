import matter from "gray-matter"
import * as yaml from "js-yaml"

export function parseMatter(input: string) {
  return matter(input, {
    engines: {
      yaml: {
        parse: (value: string) => yaml.load(value) ?? {},
        stringify: (value: unknown) => yaml.dump(value),
      },
    },
  })
}
