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

export function cleanMagnetUri(uri: string): CleanMagnetResult | null {
  const trimmed = uri.trim()
  if (!trimmed.toLowerCase().startsWith('magnet:?')) {
    return null
  }

  try {
    const queryString = trimmed.slice(8)
    const params = new URLSearchParams(queryString)

    let infoHash: string | null = null
    let dn: string | null = null
    let trackersCount = 0

    const newParams = new URLSearchParams()

    for (const [key, value] of params.entries()) {
      const lowerKey = key.toLowerCase()
      if (lowerKey === 'xt') {
        const match = value.match(/urn:btih:([a-fA-F0-9]{32,40})/i)
        if (match && !infoHash) {
          infoHash = match[1].toLowerCase()
          newParams.set('xt', `urn:btih:${match[1]}`)
        }
      } else if (lowerKey === 'dn') {
        if (!dn && value) {
          dn = value.trim()
          newParams.set('dn', dn)
        }
      } else if (lowerKey === 'tr') {
        trackersCount++
      }
    }

    if (!infoHash) {
      return null
    }

    const cleaned = `magnet:?${newParams.toString()}`

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
