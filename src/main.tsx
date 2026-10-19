import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

function BootMessage() {
  return <main><h1>Campus Recall</h1><p>Application foundation is ready.</p></main>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><BootMessage /></StrictMode>);