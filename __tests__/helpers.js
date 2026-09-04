// Test helper: loads an extension file by mocking registerExtension() and
// capturing the extension definition object. Also provides a mock ctx.xFetch
// that returns canned HTML responses.

import { readFileSync } from 'fs';
import { resolve } from 'path';

const EXT_DIR = resolve(import.meta.dirname, '..', 'extensions');

/**
 * Load an extension definition from its JS source file.
 * @param {string} filename  e.g. "site.kolnovel.js"
 * @returns {object} The extension config object (with all methods bound).
 */
export function loadExtension(filename) {
  let captured = null;
  const mockRegister = (ext) => { captured = ext; };

  // The extension JS calls registerExtension({...}) at top level.
  // Execute it in a sandboxed function scope with our mock.
  const code = readFileSync(resolve(EXT_DIR, filename), 'utf-8');
  const fn = new Function('registerExtension', code);
  fn(mockRegister);

  if (!captured) throw new Error(`registerExtension was not called in ${filename}`);
  return captured;
}

/**
 * Create a mock ctx object whose xFetch returns pre-configured responses.
 * @param {Object<string, {ok:boolean, status:number, text:string}>} routes
 *        Map of URL substrings → response objects.
 *        First matching route wins; unmatched URLs return 404.
 */
export function mockCtx(routes = {}) {
  return {
    log: () => {},
    xFetch: async (urlOrOpts) => {
      const url = typeof urlOrOpts === 'string' ? urlOrOpts : urlOrOpts.url;
      for (const [pattern, res] of Object.entries(routes)) {
        if (url.includes(pattern)) {
          return typeof res === 'function' ? res(url) : res;
        }
      }
      return { ok: false, status: 404, text: '' };
    }
  };
}

/**
 * Shorthand: returns a successful fetch response with the given HTML body.
 */
export function ok(html, status = 200) {
  return { ok: true, status, text: html };
}

/**
 * Build a mock ctx for cenele-style extensions that issue GET page fetches AND
 * POST admin-ajax calls.
 *
 * @param {Object<string, Function|Object>} routes   GET routes: URL substring -> response.
 * @param {Function} [ajaxHandler]  (params:URLSearchParams, urlOrOpts) -> response, called
 *        for every POST. If omitted, POSTs return 404.
 */
export function mockCeneleCtx(routes = {}, ajaxHandler) {
  return {
    log: () => {},
    // Mirrors the REAL host bridge (WebViewRuntime ctx.xFetch): url from the
    // first arg (string OR object.url); init from the second arg, with a
    // fallback to the object form for legacy single-object calls.
    xFetch: async (input, idInit) => {
      const url = typeof input === 'string' ? input : (input && input.url);
      const init =
        idInit && typeof idInit === 'object'
          ? idInit
          : input && typeof input === 'object'
            ? input
            : {};
      if (init.method === 'POST') {
        if (!ajaxHandler) return { ok: false, status: 404, text: '{}' };
        const params = new URLSearchParams(init.body || '');
        return ajaxHandler(params, init);
      }
      for (const [pattern, res] of Object.entries(routes)) {
        if (url.includes(pattern)) {
          return typeof res === 'function' ? res(url, init) : res;
        }
      }
      return { ok: false, status: 404, text: '' };
    }
  };
}
