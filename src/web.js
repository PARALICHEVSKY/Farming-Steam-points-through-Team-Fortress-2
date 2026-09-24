// Minimal cookie-aware HTTP client for steamcommunity.com / store.steampowered.com.

const DOMAINS = ['steamcommunity.com', 'store.steampowered.com', 'help.steampowered.com'];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

export class HttpError extends Error {
  constructor(status, message, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export class SteamWeb {
  constructor() {
    this.sessionID = null;
    this.jar = Object.fromEntries(DOMAINS.map((d) => [d, new Map()]));
  }

  /** Accepts the cookie strings from steam-user's `webSession` event. */
  setCookies(cookies, sessionID) {
    for (const raw of cookies) {
      const [pair, ...attrs] = raw.split(';').map((s) => s.trim());
      const eq = pair.indexOf('=');
      if (eq < 1) continue;
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      const domainAttr = attrs.find((a) => a.toLowerCase().startsWith('domain='));
      const domain = domainAttr ? domainAttr.slice(7).replace(/^\./, '') : null;
      for (const d of DOMAINS) {
        if (!domain || d === domain || d.endsWith(`.${domain}`)) this.jar[d].set(name, value);
      }
    }
    // sessionid is a double-submit CSRF token: the cookie just has to match the form field.
    this.sessionID = (sessionID || this.jar['steamcommunity.com'].get('sessionid') || '').split(';')[0].trim();
    for (const d of DOMAINS) this.jar[d].set('sessionid', this.sessionID);
  }

  cookieHeader(url) {
    const host = new URL(url).hostname;
    const d = DOMAINS.find((x) => host === x || host.endsWith(`.${x}`));
    if (!d) return '';
    return [...this.jar[d]].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  async request(url, { method = 'GET', form, headers = {}, json = true, referer } = {}) {
    const h = {
      'User-Agent': UA,
      Cookie: this.cookieHeader(url),
      ...(referer ? { Referer: referer } : {}),
      ...headers,
    };
    let body;
    if (form) {
      body = new URLSearchParams(Object.entries(form).map(([k, v]) => [k, String(v)])).toString();
      h['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
      h.Origin = new URL(url).origin;
    }
    const res = await fetch(url, { method, headers: h, body, redirect: 'follow' });
    const text = await res.text();
    if (res.status === 429) throw new HttpError(429, 'Steam вернул 429 (слишком много запросов)', text);
    let data = text;
    if (json) {
      try {
        data = JSON.parse(text);
      } catch {
        if (!res.ok) throw new HttpError(res.status, `HTTP ${res.status} ${url}`, text);
        throw new HttpError(res.status, `Ожидался JSON от ${url}, получено: ${text.slice(0, 200)}`, text);
      }
    }
    if (!res.ok) {
      const msg = (json && data && data.message) || `HTTP ${res.status} ${url}`;
      throw new HttpError(res.status, msg, data);
    }
    return { data, url: res.url, status: res.status };
  }

  get(url, opts) {
    return this.request(url, { ...opts, method: 'GET' });
  }

  post(url, form, opts) {
    return this.request(url, { ...opts, method: 'POST', form: { sessionid: this.sessionID, ...form } });
  }
}
