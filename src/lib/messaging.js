// One way to talk to the background page.
//
// Firefox's `browser.runtime.sendMessage` is promise-based and treats a second argument as
// its options object, so passing a Chrome-style callback there silently breaks. Detect which
// shape we got and adapt, rather than assuming either.

const api = globalThis.browser ?? globalThis.chrome;

function unwrap(res) {
  if (!res) throw new Error('No response from the extension background page.');
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

export function send(type, payload) {
  const message = { type, payload };
  const maybePromise = api.runtime.sendMessage(message);

  if (maybePromise && typeof maybePromise.then === 'function') {
    return maybePromise.then(unwrap); // Firefox / promise-based polyfills
  }

  return new Promise((resolve, reject) => {
    api.runtime.sendMessage(message, (res) => {
      const err = api.runtime.lastError;
      if (err) return reject(new Error(err.message));
      try { resolve(unwrap(res)); } catch (e) { reject(e); }
    });
  });
}
