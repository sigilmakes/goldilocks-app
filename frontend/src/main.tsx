import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';

// Apply persisted theme on startup
try {
  const stored = JSON.parse(localStorage.getItem('goldilocks-settings') || '{}');
  const theme = stored?.state?.theme ?? 'dark';
  document.documentElement.classList.add(theme);
} catch {
  document.documentElement.classList.add('dark');
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
