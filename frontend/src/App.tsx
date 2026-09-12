import { RouterProvider } from 'react-router'
import { TooltipProvider } from '@/components/ui/tooltip'
import { router } from './routes/router'

export function App() {
  return (
    <TooltipProvider delayDuration={200}>
      <RouterProvider router={router} />
    </TooltipProvider>
  )
}

export default App
