import { RouterProvider } from 'react-router'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { router } from './routes/router'

export function App() {
  return (
    <TooltipProvider delayDuration={200}>
      <RouterProvider router={router} />
      <Toaster position="top-right" closeButton duration={4000} />
    </TooltipProvider>
  )
}

export default App
