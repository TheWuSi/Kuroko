import type { StorageNodeInfo } from '@/types/api'

export function summarizeStorage(nodes: StorageNodeInfo[]) {
  const visible = nodes.filter((node) => !node.ignored)
  return {
    total: visible.reduce((sum, node) => sum + (node.total_space ?? 0), 0),
    free: visible.reduce((sum, node) => sum + (node.free_space ?? 0), 0),
    unknown: visible.filter((node) => node.free_space === null).length,
    count: visible.length,
  }
}

export function variantLabel(variant: string) {
  return variant === 'original' ? '原版' : `-${variant}`
}

export function partLabel(part: number | null | undefined) {
  return part == null ? '' : part === 0 ? '基础分集' : `分集 ${part}`
}
