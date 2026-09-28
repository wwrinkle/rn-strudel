// rn-strudel's environment first: Web Audio globals plus the browser stubs Strudel's packages touch on import.
import 'rn-strudel/environment';
import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
