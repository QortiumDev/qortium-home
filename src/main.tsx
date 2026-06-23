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

// Report first paint to the main process for startup timing (best-effort; absent
// on web/Android where the bridge has no system channel). Two rAFs ensure we
// measure after the first frame is actually painted, not just committed.
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    const navToPaintMs = performance.now();
    console.log(`[startup] renderer first paint at ${Math.round(navToPaintMs)}ms since navigation start`);
    void window.qortiumHome.system?.reportStartupPaint?.(navToPaintMs);
  });
});
