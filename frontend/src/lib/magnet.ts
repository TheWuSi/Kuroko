/**
 * 前端即时磁力链接清洗工具
 * 规范化保留 xt 和 dn，剔除冗余的 tr (Tracker) 及统计参数
 */
export interface CleanMagnetResult {
  cleaned: string
  trackersRemoved: number
  dn: string | null
  infoHash: string | null
}

export function normalizeInfoHash(value: string): string | null {
  if (/^[a-f0-9]{40}$/i.test(value)) return value.toLowerCase()
  if (!/^[a-z2-7]{32}$/i.test(value)) return null
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let buffer = 0
  let bits = 0
  let hex = ''
  for (const char of value.toUpperCase()) {
    buffer = (buffer << 5) | alphabet.indexOf(char)
    bits += 5
    if (bits >= 8) {
      bits -= 8
      hex += ((buffer >> bits) & 255).toString(16).padStart(2, '0')
      buffer &= (1 << bits) - 1
    }
  }
  return hex
}

export function cleanMagnetUri(uri: string): CleanMagnetResult | null {
  if (uri.length > 8192 || Array.from(uri).some((char) => char.charCodeAt(0) < 32)) return null
  const trimmed = uri.trim()
  if (!trimmed.toLowerCase().startsWith('magnet:?') || trimmed.includes('#')) {
    return null
  }

  try {
    const queryString = trimmed.slice(8)
    const params = new URLSearchParams(queryString)

    let infoHash: string | null = null
    let dn: string | null = null
    let trackersCount = 0

    for (const [key, value] of params.entries()) {
      const lowerKey = key.toLowerCase()
      if (lowerKey === 'xt') {
        const match = value.match(/^urn:btih:(.+)$/i)
        if (match && !infoHash) {
          infoHash = normalizeInfoHash(match[1])
          if (!infoHash) return null
        }
      } else if (lowerKey === 'dn') {
        if (!dn && value) {
          dn = Array.from(value).slice(0, 1024).join('')
        }
      } else if (lowerKey === 'tr') {
        trackersCount++
      }
    }

    if (!infoHash) {
      return null
    }

    // xt 的 URN 分隔符必须保留冒号，避免部分离线工具拒绝百分号编码后的链接。
    const displayName = dn ? `&${new URLSearchParams({ dn }).toString()}` : ''
    const cleaned = `magnet:?xt=urn:btih:${infoHash}${displayName}`

    return {
      cleaned,
      trackersRemoved: trackersCount,
      dn,
      infoHash,
    }
  } catch {
    return null
  }
}

/**
 * 批量处理多行输入文本
 */
export function cleanBatchMagnets(text: string): {
  cleanedText: string
  totalCleaned: number
  totalTrackersRemoved: number
  validMagnets: string[]
} {
  const lines = text.split('\n')
  let totalTrackersRemoved = 0
  let totalCleaned = 0
  const validMagnets: string[] = []

  const processedLines = lines.map((line) => {
    const trimmed = line.trim()
    if (!trimmed) return ''
    const result = cleanMagnetUri(trimmed)
    if (result) {
      totalCleaned++
      totalTrackersRemoved += result.trackersRemoved
      validMagnets.push(result.cleaned)
      return result.cleaned
    }
    return line
  })

  return {
    cleanedText: processedLines.join('\n'),
    totalCleaned,
    totalTrackersRemoved,
    validMagnets,
  }
}
