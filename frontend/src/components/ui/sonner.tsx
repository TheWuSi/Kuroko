"use client"

import {
  CircleCheck,
  Info,
  LoaderCircle,
  OctagonX,
  TriangleAlert,
} from "lucide-react"
import { useTheme } from "@/hooks/useTheme"
import type { CSSProperties } from "react"
import { Toaster as Sonner } from "sonner"

type ToasterProps = React.ComponentProps<typeof Sonner>

const Toaster = ({ ...props }: ToasterProps) => {
  const { resolvedTheme } = useTheme()

  // Sonner 自带样式不在 Tailwind 分层内，使用变量和显式覆盖保持主题一致。
  return (
    <Sonner
      theme={resolvedTheme}
      containerAriaLabel="通知"
      mobileOffset={20}
      className="toaster group"
      style={{
        "--normal-bg": "var(--popover)",
        "--normal-text": "var(--popover-foreground)",
        "--normal-border": "var(--border)",
        "--normal-bg-hover": "var(--accent)",
        "--normal-border-hover": "var(--input)",
      } as CSSProperties}
      icons={{
        success: <CircleCheck className="h-4 w-4" />,
        info: <Info className="h-4 w-4" />,
        warning: <TriangleAlert className="h-4 w-4" />,
        error: <OctagonX className="h-4 w-4" />,
        loading: <LoaderCircle className="h-4 w-4 animate-spin" />,
      }}
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground!",
          actionButton:
            "group-[.toast]:bg-primary! group-[.toast]:text-primary-foreground! max-md:min-h-11",
          cancelButton:
            "group-[.toast]:bg-muted! group-[.toast]:text-muted-foreground! max-md:min-h-11",
          // 扩大触控区域，同时保留标准关闭图标的视觉尺寸。
          closeButton: "max-md:before:absolute max-md:before:-inset-3.5",
          success: "[&_[data-icon]]:text-success",
          error: "[&_[data-icon]]:text-destructive",
          warning: "[&_[data-icon]]:text-warning",
          info: "[&_[data-icon]]:text-info",
        },
        closeButtonAriaLabel: "关闭提示",
      }}
      {...props}
    />
  )
}

export { Toaster }
