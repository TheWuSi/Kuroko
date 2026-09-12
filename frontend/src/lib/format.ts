/**
 * 格式化字节大小为易读字符串 (B, KB, MB, GB, TB)
 */
export function formatBytes(bytes: number | null | undefined, decimals: number = 2): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return '未知'
  if (bytes === 0) return '0 B'
  const k = 1024
  const dm = decimals < 0 ? 0 : decimals
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(k))
  const idx = Math.max(0, Math.min(i, sizes.length - 1))
  return `${parseFloat((bytes / Math.pow(k, idx)).toFixed(dm))} ${sizes[idx]}`
}

/**
 * 格式化 ISO 日期时间
 */
export function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return '-'
  try {
    const date = new Date(dateString)
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
  } catch {
    return dateString
  }
}

/**
 * 格式化传输速率
 */
export function formatSpeed(speed: string | number | null | undefined): string {
  if (speed === null || speed === undefined || speed === '') return '未知'
  if (typeof speed === 'string' && (speed.includes('/s') || speed.includes('/S'))) {
    return speed
  }
  const numeric = typeof speed === 'string' ? parseFloat(speed) : speed
  if (!Number.isFinite(numeric) || numeric < 0) return '未知'
  return `${formatBytes(numeric)}/s`
}
