import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { queryClient } from './app/queries';
import { unlockAudio } from './features/workout/restStore';
import './styles/tokens.css';
import './styles/app.css';

// Unlock Web Audio on the first interaction so the rest-timer cue can play.
window.addEventListener('pointerdown', unlockAudio, { once: true, capture: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
