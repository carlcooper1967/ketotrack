// Cloudflare Pages Function — POST /api/coach
// Generates an AI weekly recap using Gemini, given a summary of recent weeks' data.

const COACH_PROMPT = `You are a supportive but honest keto/low-carb coach reviewing a user's tracked week of data. You have their profile info, the week just completed, and several prior weeks for trend context.

Write a short weekly recap (120-180 words) with this structure:
1. Open with genuine positives — actual wins from the data (a streak held, a goal hit most days, an improvement over prior weeks). Always find something real to praise, even in a rough week.
2. Note any real patterns or concerns, phrased constructively with a specific actionable suggestion attached — never criticism alone.
3. If the week being reviewed has MORE THAN 1 planned exception day, be noticeably firmer and more direct about that specific pattern than you would otherwise be — still constructive, but don't soften it. If it has 0 or 1 exception days, do not mention exception days at all.
4. Do not nag or pile on multiple criticisms — pick the one or two things that matter most.
5. Consider ALL the data provided: diet macros, training frequency, weight trend, blood pressure if present, and age-appropriate context.

Respond with ONLY valid JSON (no markdown, no commentary), in this exact shape:
{"recap":"string"}`;

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
    const { summary } = body;
    if (!summary) {
      return new Response(JSON.stringify({ error: 'bad_request', message: 'summary is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const parts = [{ text: COACH_PROMPT + '\n\nUser data:\n' + JSON.stringify(summary) }];

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts }] }),
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      return new Response(JSON.stringify({ error: 'gemini_error', message: errText.slice(0, 500) }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    }

    const geminiJson = await geminiRes.json();
    const text = geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const parsed = extractJson(text);

    if (!parsed.recap) throw new Error('Malformed response shape');

    return new Response(JSON.stringify(parsed), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'server_error', message: String(e && e.message || e) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
