let port: number | undefined

export function setListenPort(value: number | undefined) {
  port = value && value > 0 ? value : undefined
}

export function currentListenPort() {
  return port
}
