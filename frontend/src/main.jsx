import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { captureSocialAttributionFromLocation } from './services/socialAttribution.js';
import '@fontsource-variable/montserrat/wght.css';
import './i18n.js';
import './styles/index.css';
import './styles/pop-editorial.css';
import './styles/editorial-foundation.css';

try {
  captureSocialAttributionFromLocation();
} catch {
  // Attribution must never block rendering.
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
