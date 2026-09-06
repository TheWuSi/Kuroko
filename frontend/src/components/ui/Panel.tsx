import type { ReactNode } from 'react'
import { eyebrow } from './styles'

type PanelProps = { eyebrowText?: string; title: string; action?: ReactNode; extra?: ReactNode; children: ReactNode }

export function Panel({ eyebrowText, title, action, extra, children }: PanelProps) {
  return (
    <section className="mb-5 border border-slate-200 bg-white p-7 max-[600px]:p-5">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          {eyebrowText && <p className={eyebrow}>{eyebrowText}</p>}
          <h3 className="text-lg font-extrabold text-slate-800">{title}</h3>
        </div>
        {action || extra}
      </div>
      {children}
    </section>
  )
}
