import { bootstrapExtraDataHome, ExtraDataPathError } from "@opencode-ai/core/extra-data"
import { EOL } from "os"

try {
  bootstrapExtraDataHome()
} catch (error) {
  const message = error instanceof ExtraDataPathError ? error.message : String(error)
  process.stderr.write(`ONECODE_EXTRA_PATH is invalid: ${message}${EOL}`)
  process.exit(1)
}
