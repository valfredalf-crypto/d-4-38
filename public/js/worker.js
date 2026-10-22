import { analyze } from './analyze.js';

self.onmessage = (e) => {
  const { id, payload } = e.data;
  try {
    self.postMessage({ id, result: analyze(payload, payload.settings) });
  } catch (err) {
    self.postMessage({ id, error: err.message });
  }
};
