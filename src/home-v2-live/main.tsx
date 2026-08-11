import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HomeV2LiveApp } from './HomeV2LiveApp'

async function start() {
  if (!window.homeV2Nodes) {
    const { installQortiumHomeApiFallback } = await import('../platform')
    installQortiumHomeApiFallback()
  }
  createRoot(document.getElementById('root') as HTMLElement).render(
    <StrictMode>
      <HomeV2LiveApp />
    </StrictMode>,
  )
}

void start()
