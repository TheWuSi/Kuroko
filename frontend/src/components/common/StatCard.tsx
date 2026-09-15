import React from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface StatCardProps {
  title: string
  value: string | number
  description?: string
  icon: React.ReactNode
  trend?: string
  className?: string
}

export function StatCard({
  title,
  value,
  description,
  icon,
  trend,
  className,
}: StatCardProps) {
  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardContent className="p-5 sm:p-6">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <div className="p-2.5 rounded-xl bg-primary/10 text-primary">
            {icon}
          </div>
        </div>
        <div className="mt-3">
          <div className="text-2xl sm:text-3xl font-bold font-mono tracking-tight text-foreground">
            {value}
          </div>
          {(description || trend) && (
            <div className="mt-1.5 flex items-center text-xs text-muted-foreground">
              {trend && <span className="text-success font-medium mr-1.5">{trend}</span>}
              <span>{description}</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
