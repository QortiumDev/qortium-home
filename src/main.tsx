import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyDisplaySettings, getInitialDisplaySettings, loadDisplaySettings } from './displaySettings';
import { installQortiumHomeApiFallback } from './platform';

installQortiumHomeApiFallback();
applyDisplaySettings(getInitialDisplaySettings());
void loadDisplaySettings()
  .then(applyDisplaySettings)
  .catch(() => {
    // Keep the default display settings if preference storage is unavailable during startup.
  });

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);
