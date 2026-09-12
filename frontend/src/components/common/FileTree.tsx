import { useState } from 'react'
import type { ParsedFileItem } from '@/types/api'
import { formatBytes } from '@/lib/format'
import { ChevronDown, ChevronRight, FileVideo, Ban } from 'lucide-react'
import { Badge } from '@/components/ui/badge'

interface FileTreeProps {
  files: ParsedFileItem[]
  filteredFiles?: ParsedFileItem[]
  defaultOpen?: boolean
}

export function FileTree({ files, filteredFiles = [], defaultOpen = false }: FileTreeProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  const allFiles = [
    ...files.map((f) => ({ ...f, isFiltered: false })),
    ...filteredFiles.map((f) => ({ ...f, isFiltered: true })),
  ]

  if (allFiles.length === 0) {
    return <div className="text-xs text-slate-400 py-1 font-mono">种子内无文件信息或元数据未就绪</div>
  }

  const filterReasonText = (reason?: string | null) => {
    switch (reason) {
      case 'extension':
        return '非视频格式'
      case 'size':
        return '体积过小'
      case 'blacklist_pattern':
        return '广告黑名单'
      default:
        return '已过滤'
    }
  }

  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden bg-white text-xs">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-3 bg-slate-50 hover:bg-slate-100 transition-colors text-slate-700 font-medium cursor-pointer"
      >
        <div className="flex items-center gap-2">
          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <span>包含文件清单 ({files.length} 个有效 / {filteredFiles.length} 个被过滤)</span>
        </div>
        <span className="text-slate-400 font-mono">
          总计 {formatBytes(allFiles.reduce((acc, cur) => acc + (cur.size || 0), 0))}
        </span>
      </button>

      {isOpen && (
        <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto font-mono">
          {allFiles.map((file, idx) => (
            <div
              key={`${file.name}-${idx}`}
              className={`p-2.5 flex items-center justify-between gap-3 ${
                file.isFiltered ? 'bg-slate-50/50 opacity-60' : 'hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                {file.isFiltered ? (
                  <Ban className="h-3.5 w-3.5 text-rose-500 shrink-0" />
                ) : (
                  <FileVideo className="h-3.5 w-3.5 text-blue-600 shrink-0" />
                )}
                <span className="truncate text-slate-800" title={file.name}>
                  {file.name}
                </span>
                {file.isFiltered && (
                  <Badge variant="destructive" className="text-[10px] px-1.5 py-0 shrink-0">
                    {filterReasonText(file.filter_reason)}
                  </Badge>
                )}
              </div>
              <span className="text-slate-500 shrink-0 font-medium">
                {formatBytes(file.size)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
