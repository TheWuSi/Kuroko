import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ThemeProvider } from '@/components/common/ThemeProvider'
import './styles/globals.css'

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('未能找到 DOM 挂载节点 #root')
}

createRoot(rootElement).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>
)
