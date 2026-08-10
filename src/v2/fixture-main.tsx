import { createRoot } from 'react-dom/client'
import { HomeV2FixturePreview } from './fixture/HomeV2FixturePreview'

const root = document.getElementById('root')
if (!root) {
  throw new Error('Home v2 fixture root was not found.')
}

createRoot(root).render(<HomeV2FixturePreview />)
