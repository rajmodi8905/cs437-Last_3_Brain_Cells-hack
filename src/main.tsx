import { createRoot } from 'react-dom/client';
import { createAnyRecallServices } from './app/services';
import { App } from './ui/App';
import './ui/styles.css';
const services = createAnyRecallServices();
createRoot(document.getElementById('root')!).render(<App services={services} />);
