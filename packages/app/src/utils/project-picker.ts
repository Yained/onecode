export function shouldUseNativeProjectPicker(input: {
  hasNativePicker: boolean
  isLocalServer: boolean
  hasPlatformSession: boolean
}) {
  return input.hasNativePicker && input.isLocalServer && !input.hasPlatformSession
}
