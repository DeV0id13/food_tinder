import './styles.css';
import {FoodTinderApp} from './app.js';
import {createApi, resolveApiMode} from './api/index.js';

const mode = resolveApiMode();

document.addEventListener('error', ({target}) => {
  if (target instanceof HTMLImageElement && target.classList.contains('recipe-image')) {
    target.hidden = true;
  }
}, true);

const app = new FoodTinderApp({
  root: document.querySelector('#app'),
  dialog: document.querySelector('#app-dialog'),
  toast: document.querySelector('#toast'),
  api: createApi(mode),
  mode,
});

app.start();
