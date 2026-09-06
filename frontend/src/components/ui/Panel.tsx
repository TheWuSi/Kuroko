import type { ReactNode } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from './card'
import { eyebrow } from './styles'

type PanelProps = { eyebrowText?: string; title: string; action?: ReactNode; extra?: ReactNode; children: ReactNode }

export function Panel({ eyebrowText, title, action, extra, children }: PanelProps) {
  return (
    <Card className="mb-5">
      <CardHeader className="mb-0">
        <div>
          {eyebrowText && <p className={eyebrow}>{eyebrowText}</p>}
          <CardTitle>{title}</CardTitle>
        </div>
        {action || extra}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}
