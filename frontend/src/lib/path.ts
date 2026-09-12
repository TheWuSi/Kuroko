export function normalizeStoragePath(value: string): string {
  const path = value.trim()
  if (
    !path.startsWith('/') || path.length > 1024 || path.includes('\\') ||
    Array.from(path).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
    path.split('/').includes('..')
  ) {
    throw new Error('请输入以 / 开头的有效目录，不可包含 ..、反斜线或控制字符')
  }
  return '/' + path.split('/').filter((part) => part && part !== '.').join('/')
}

export function joinStoragePath(mount: string, folder: string): string {
  return normalizeStoragePath(`${normalizeStoragePath(mount)}/${normalizeStoragePath(folder).slice(1)}`)
}
