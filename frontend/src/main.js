import './styles.css';
import {FoodTinderApp} from './app.js';
import {RealApi} from './api/real-api.js';

document.addEventListener('error', ({target}) => {
  if (target instanceof HTMLImageElement && target.classList.contains('recipe-image')) {
    target.hidden = true;
  }
}, true);

const app = new FoodTinderApp({
  root: document.querySelector('#app'),
  dialog: document.querySelector('#app-dialog'),
  toast: document.querySelector('#toast'),
  api: new RealApi(),
});

app.start();
