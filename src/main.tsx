import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import {
  applyTextSizeSetting,
  getInitialTextSizeSetting,
  loadTextSizeSetting,
} from './displaySettings';
import { installQortiumHomeApiFallback } from './platform';

installQortiumHomeApiFallback();
applyTextSizeSetting(getInitialTextSizeSetting());
void loadTextSizeSetting()
  .then(applyTextSizeSetting)
  .catch(() => {
    // Keep the default display size if preference storage is unavailable during startup.
  });

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);
