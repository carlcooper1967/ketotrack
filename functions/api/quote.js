// Cloudflare Pages Function — GET /api/quote
// Fetches a batch of 50 quotes from ZenQuotes and returns them all — the frontend
// tracks which ones it has already shown recently so none repeat until the batch cycles.

export async function onRequestGet() {
  try {
    const res = await fetch('https://zenquotes.io/api/quotes');
    if (!res.ok) {
      return new Response(JSON.stringify({ error: 'upstream_error', message: 'Could not reach the quote service.' }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    }
    const data = await res.json();
    const quotes = (Array.isArray(data) ? data : []).map(q => ({ text: q.q, author: q.a }));
    return new Response(JSON.stringify({ quotes }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'server_error', message: String(e && e.message || e) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
