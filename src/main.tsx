import { createRoot } from 'react-dom/client';
import { removeOldStorage } from './app/oldStorage';
import { createAnyRecallServices } from './app/services';
import { App } from './ui/App';
import './ui/styles.css';
// What the app stored under its earlier name is removed once; it never delays the app.
void removeOldStorage().catch(() => undefined);
const services = createAnyRecallServices();
createRoot(document.getElementById('root')!).render(<App services={services} />);
