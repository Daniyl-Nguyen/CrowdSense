import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App.tsx';
import './ui/app.css';
import './ui/pages.css';
import './ui/studio.css';

document.documentElement.dataset.theme = 'light';

try {
  const theme = localStorage.getItem('rtr.theme');
  if (theme) document.documentElement.dataset.theme = JSON.parse(theme);
} catch {
  /* ignore */
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
