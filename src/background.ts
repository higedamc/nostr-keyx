// SPDX-FileCopyrightText: 2023 Susumu OTA <1632335+susumuota@users.noreply.github.com>
// SPDX-License-Identifier: MIT

// https://developer.chrome.com/docs/apps/nativeMessaging/
// https://dev.classmethod.jp/articles/chrome-native-message/

import { NIP_07_APIS, getAccount, getURLList } from './common';

const setBadge = (text: string, color: string) => {
  chrome.action.setBadgeText({ text });
  if (color) chrome.action.setBadgeBackgroundColor({ color });
};

// connect to `nostr_keyx` native messaging host.
let nativePort: chrome.runtime.Port | null;
nativePort = chrome.runtime.connectNative('io.github.susumuota.nostr_keyx');
if (chrome.runtime.lastError) { // TODO: never happens?
  console.log('background.ts: connectNative:', chrome.runtime.lastError.message);
  setBadge('!', 'red');
}

// if `nostr_keyx` native app is not installed, show error message and set badge color to red.
nativePort.onDisconnect.addListener(() => {
  if (chrome.runtime.lastError) {
    console.log('background.ts: nativePort.onDisconnect:', chrome.runtime.lastError.message);
    setBadge('!', 'red');
    chrome.tabs.create({ url: 'notice.html' });
  }
  nativePort = null;
});

// TODO: need more sophisticated API usage stats?
let count = 0;

// receive requests from `content.ts` and send responses to `content.ts`.
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    console.debug('background.ts: onMessage: request', request);
    console.debug('background.ts: onMessage: sender', sender);

    const send = (response: any) => {
      (response.error ? console.log : console.debug)('background.ts: onMessage: response', response);
      if (['signEvent', 'nip04.encrypt', 'nip04.decrypt'].includes(request.method)) count += 1;
      count = count % 10;
      response.error ? setBadge('!', 'red') : setBadge(count.toString(), 'white');
      sendResponse(response);
    };

    // check sender
    if (!sender.origin) {
      send({ id: request.id, result: null, error: 'no origin' });
      return true;
    }
    const origin = sender.origin;
    const urlList = await getURLList();
    if (!urlList.includes(origin)) {
      send({ id: request.id, result: null, error: 'invalid origin' });
      return true;
    }

    // check request method
    const { id, method }: { id: string, method: string } = request;
    if (!(id && NIP_07_APIS.includes(method) || method === 'inject')) {
      send({ id, result: null, error: 'invalid method' });
      return true;
    }

    // inject `inject.ts` to the page (e.g. iris, snort, etc.) to provide `window.nostr`.
    // TODO: this executeScript will be removed when Chrome 111 is released (it's beta right now).
    // this is `Method 4` of this post but `Method 5` is rather simple and clean (but requires Chrome 111+).
    // https://stackoverflow.com/a/9517879
    if (method === 'inject') {
      if (!(sender.tab && sender.tab.id)) {
        send({ id, result: null, error: 'no tab' });
        return true;
      }
      const tabId = sender.tab.id;
      const results = await chrome.scripting.executeScript({
        target: { tabId }, world: 'MAIN', files: ['inject.js'] // world: 'MAIN' is important
      });
      send({ id, result: results, error: null });
      return true;
    }

    // send request to `nostr_keyx` native app.
    // `sendNativeMessage` also work, but it spawns a node process every call, which is very slow.
    // native port spawns a node process only once, which is much faster.

    if (!nativePort) {
      send({ id, result: null, error: 'no nativePort' });
      return true;
    }

    const listener = (response: any) => {
      if (response.id !== id) return;
      nativePort?.onMessage.removeListener(listener);
      send(response);
    };
    nativePort.onMessage.addListener(listener);
    // append account to the request
    nativePort.postMessage({...request, account: await getAccount()});
    return true;
  })();
  return true;
});

export {} // TODO
