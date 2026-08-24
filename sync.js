// Cloudflare Pages Function — GET/POST /api/sync
// Mirrors localStorage 1:1 into D1, keyed by deviceId + key.
// GET  ?deviceId=xxx           -> { data: { key: value, ... }, updatedAt: { key: timestamp, ... } }
// POST { deviceId, ops: [{ key, value, deleted }] } -> { ok: true }

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const deviceId = url.searchParams.get('deviceId');
    if (!deviceId) {
      return json({ error: 'bad_request', message: 'deviceId is required' }, 400);
    }
    const { results } = await env.DB.prepare(
      'SELECT key, value, updated_at FROM kv_store WHERE device_id = ?'
    ).bind(deviceId).all();

    const data = {};
    const updatedAt = {};
    for (const row of results) {
      data[row.key] = row.value;
      updatedAt[row.key] = row.updated_at;
    }
    return json({ data, updatedAt });
  } catch (e) {
    return json({ error: 'server_error', message: String(e && e.message || e) }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const { deviceId, ops } = body;
    if (!deviceId || !Array.isArray(ops)) {
      return json({ error: 'bad_request', message: 'deviceId and ops[] are required' }, 400);
    }
    const now = Date.now();

    const statements = ops.map(op => {
      if (op.deleted) {
        return env.DB.prepare('DELETE FROM kv_store WHERE device_id = ? AND key = ?').bind(deviceId, op.key);
      }
      return env.DB.prepare(
        `INSERT INTO kv_store (device_id, key, value, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(device_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      ).bind(deviceId, op.key, op.value, op.updatedAt || now);
    });

    if (statements.length > 0) {
      await env.DB.batch(statements);
    }
    return json({ ok: true, count: statements.length });
  } catch (e) {
    return json({ error: 'server_error', message: String(e && e.message || e) }, 500);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
