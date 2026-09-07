// Cloudflare Pages Function — POST /api/suggest
// Generates a short, live suggestion for a specific exercise using Gemini, based on that
// exercise's own past logged history (weights/reps/dates). Shown when the user picks an
// exercise to log, so it needs to stay brief and fast.

const SUGGEST_PROMPT = `You are a knowledgeable strength coach. The user is about to log a set of a specific exercise. You have their past logged history for THIS exercise only (dates, sets, weight, reps).

Write ONE short, specific, actionable suggestion (1-2 sentences, under 30 words) for today's session — e.g. suggest a weight/rep target to beat their recent best, note a pattern (getting stronger, plateauing, been a while since they did this one), or encourage good form/rest if they've been pushing hard. Be concrete with numbers when history supports it. If there's no history at all (first time logging this exercise), just give a brief, encouraging note to start conservatively and track it.

Respond with ONLY valid JSON (no markdown, no commentary), in this exact shape:
{"suggestion":"string"}`;

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
    const { exerciseName, history } = body;
    if (!exerciseName) {
      return new Response(JSON.stringify({ error: 'bad_request', message: 'exerciseName is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const parts = [{ text: SUGGEST_PROMPT + `\n\nExercise: ${exerciseName}\nPast history (most recent first):\n` + JSON.stringify(history || []) }];

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
    if (!parsed.suggestion) throw new Error('Malformed response shape');

    return new Response(JSON.stringify(parsed), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'server_error', message: String(e && e.message || e) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
