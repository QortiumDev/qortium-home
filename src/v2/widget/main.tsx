import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { WidgetShell } from './WidgetShell'

const container = document.getElementById('root')
if (container) {
  createRoot(container).render(<StrictMode><WidgetShell /></StrictMode>)
}
