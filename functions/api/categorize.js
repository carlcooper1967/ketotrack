// Cloudflare Pages Function — POST /api/categorize
// Given a list of food names, returns a unit-category for each, used to decide which
// units its picker should offer (e.g. a liquid/sauce gets tbsp/fl oz/cup; bread gets slice).
// Called in batches — for newly-logged foods that don't have a category yet, and for the
// daily sweep that catches anything left uncategorized.

const CATEGORIES = ['liquid', 'sliced', 'piece', 'weight'];

const CATEGORIZE_PROMPT = `You are categorizing food items by how they are typically measured, so an app can offer the right units for each.

Categories:
- "liquid": sauces, dressings, drinks, oils, syrups — anything measured by volume (tbsp/fl oz/cup)
- "sliced": bread, cheese slices, deli meat slices — anything measured by slice
- "piece": eggs, nuggets, fruit, countable whole items — anything measured by piece/count
- "weight": meat portions, snacks, cereal, anything more naturally measured by weight (oz/g)

For each food name given, respond with its best-fit category. If genuinely ambiguous, pick the most common everyday measurement for that food.

Respond with ONLY valid JSON (no markdown, no commentary), in this exact shape:
{"results":[{"name":"string","category":"liquid"|"sliced"|"piece"|"weight"}]}`;

function extractJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON found in model response');
  return JSON.parse(match[0]);
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.GEMINI_API_KEY) {
      return new Response(JSON.stringify({ error: 'not_configured', message: 'GEMINI_API_KEY is not set.' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
    const body = await request.json();
    const { names } = body;
    if (!names || !Array.isArray(names) || names.length === 0) {
      return new Response(JSON.stringify({ error: 'bad_request', message: 'names must be a non-empty array' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const parts = [{ text: CATEGORIZE_PROMPT + '\n\nFood names:\n' + JSON.stringify(names) }];

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${env.GEMINI_API_KEY}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts }] }) }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      return new Response(JSON.stringify({ error: 'gemini_error', message: errText.slice(0, 500) }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    }

    const geminiJson = await geminiRes.json();
    const text = geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const parsed = extractJson(text);
    if (!parsed.results || !Array.isArray(parsed.results)) throw new Error('Malformed response shape');

    // sanitize — only accept known categories, default to 'piece' for anything unexpected
    const results = parsed.results.map(r => ({ name: r.name, category: CATEGORIES.includes(r.category) ? r.category : 'piece' }));

    return new Response(JSON.stringify({ results }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'server_error', message: String(e && e.message || e) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
