import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { AuthProvider } from '@/lib/auth'
import { DataProvider } from '@/lib/data'
import { assertProductionConfiguration } from '@/lib/config'
import './styles/global.css'
import './features.css'

assertProductionConfiguration()
registerSW({ immediate: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider><DataProvider><App /></DataProvider></AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
