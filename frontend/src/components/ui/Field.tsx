import type { ReactNode } from 'react'
import { Label } from './label'

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Label>
      {label}
      {children}
    </Label>
  )
}
