// Cloudflare Pages Function — GET /api/daylight?lat=..&lng=..
// Looks up today's sunrise/sunset for a given location using the free sunrise-sunset.org API.
// Cached client-side per day, so this only gets called once daily.

export async function onRequestGet({ request }) {
  try {
    const url = new URL(request.url);
    const lat = url.searchParams.get('lat');
    const lng = url.searchParams.get('lng');
    if (!lat || !lng) {
      return new Response(JSON.stringify({ error: 'bad_request', message: 'lat and lng are required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const apiUrl = `https://api.sunrise-sunset.org/json?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}&formatted=0`;
    const res = await fetch(apiUrl);
    if (!res.ok) {
      return new Response(JSON.stringify({ error: 'upstream_error', message: 'Could not reach the sunrise/sunset service.' }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    }
    const data = await res.json();
    if (data.status !== 'OK') {
      return new Response(JSON.stringify({ error: 'upstream_error', message: 'Sunrise/sunset lookup failed.' }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ sunrise: data.results.sunrise, sunset: data.results.sunset }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'server_error', message: String(e && e.message || e) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
