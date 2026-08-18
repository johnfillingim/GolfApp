import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { moneyChecks } from './scoring';
import './index.css';

// A zero-sum violation means an engine invented or destroyed money — a real bug
// worth failing loudly on in development. On a phone in the middle of a round it
// is not worth blowing up the app over, so production logs it and carries on.
moneyChecks.strict = import.meta.env.DEV;

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
