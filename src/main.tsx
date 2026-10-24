import { createRoot } from 'react-dom/client';
import { createCampusRecallServices } from './app/services';
import { App } from './ui/App';
import './ui/styles.css';
const services = createCampusRecallServices();
createRoot(document.getElementById('root')!).render(<App services={services} />);
