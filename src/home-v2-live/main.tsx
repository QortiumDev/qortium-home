import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HomeV2LiveApp } from './HomeV2LiveApp'

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <HomeV2LiveApp />
  </StrictMode>,
)
