import { createApp } from 'vue';
import { Dialog, Notify } from 'quasar';
import { get1t } from './scripts/onetagger';
import router from './scripts/router';
import iconSet from 'quasar/icon-set/mdi-v6';

import '@quasar/extras/mdi-v6/mdi-v6.css';
import 'quasar/src/css/index.sass';
import './style/app.scss';

import App from './App.vue';

if (window.chrome && window.chrome.webview) {
    window.chrome.webview.addEventListener('message', (e: MessageEvent) => {
        get1t().onOSMessage(JSON.parse(e.data));
    });
}

createApp(App)
    .use(router)
    .use(Quasar, {
        plugins: [Dialog, Notify],
        iconSet
    })
    .mount('#app');
