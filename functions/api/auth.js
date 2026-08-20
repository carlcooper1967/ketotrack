// Cloudflare Pages Function — POST /api/auth?action=setup|verify|recover|check
// PIN is never stored in plain text — salted SHA-256 hash only.

async function hashPin(pin, salt) {
  const enc = new TextEncoder();
  const data = enc.encode(salt + ':' + pin);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function randomSalt() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function currentMonthKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPost({ request, env }) {
  try {
    const url = new URL(request.url);
    const action = url.searchParams.get('action');
    const body = await request.json();
    const { deviceId } = body;
    if (!deviceId) return json({ error: 'bad_request', message: 'deviceId is required' }, 400);

    if (action === 'check') {
      const row = await env.DB.prepare('SELECT last_verified_month FROM device_auth WHERE device_id = ?').bind(deviceId).first();
      if (!row) return json({ hasPin: false });
      return json({ hasPin: true, verifiedThisMonth: row.last_verified_month === currentMonthKey() });
    }

    if (action === 'setup') {
      const { pin, birthYear } = body;
      if (!pin || !birthYear) return json({ error: 'bad_request', message: 'pin and birthYear are required' }, 400);
      const salt = randomSalt();
      const pinHash = await hashPin(pin, salt);
      await env.DB.prepare(
        `INSERT INTO device_auth (device_id, pin_hash, salt, birth_year, last_verified_month, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(device_id) DO UPDATE SET pin_hash = excluded.pin_hash, salt = excluded.salt, birth_year = excluded.birth_year, last_verified_month = excluded.last_verified_month`
      ).bind(deviceId, pinHash, salt, birthYear, currentMonthKey(), Date.now()).run();
      return json({ ok: true });
    }

    if (action === 'verify') {
      const { pin } = body;
      const row = await env.DB.prepare('SELECT pin_hash, salt FROM device_auth WHERE device_id = ?').bind(deviceId).first();
      if (!row) return json({ valid: false, reason: 'no_pin_set' });
      const attemptHash = await hashPin(pin, row.salt);
      const valid = attemptHash === row.pin_hash;
      if (valid) {
        await env.DB.prepare('UPDATE device_auth SET last_verified_month = ? WHERE device_id = ?').bind(currentMonthKey(), deviceId).run();
      }
      return json({ valid });
    }

    if (action === 'recover') {
      const { birthYear, newPin } = body;
      const row = await env.DB.prepare('SELECT birth_year FROM device_auth WHERE device_id = ?').bind(deviceId).first();
      if (!row) return json({ valid: false, reason: 'no_pin_set' });
      if (parseInt(birthYear) !== row.birth_year) return json({ valid: false, reason: 'wrong_birth_year' });
      const salt = randomSalt();
      const pinHash = await hashPin(newPin, salt);
      await env.DB.prepare('UPDATE device_auth SET pin_hash = ?, salt = ?, last_verified_month = ? WHERE device_id = ?')
        .bind(pinHash, salt, currentMonthKey(), deviceId).run();
      return json({ valid: true });
    }

    return json({ error: 'bad_request', message: 'unknown action' }, 400);
  } catch (e) {
    return json({ error: 'server_error', message: String(e && e.message || e) }, 500);
  }
}
