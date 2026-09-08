// Cloudflare Pages Function — POST /api/suggest
// Generates a short, live suggestion using Gemini when the user is about to log a workout.
// Works for a specific Strength exercise (exerciseName + that exercise's own history) or for
// any other training type (Walk/Cardio/Cycling/Mobility/Mixed — type + recent sessions of that type).
// Now also factors in personal context (age, weight trend, latest BP, goals), not just past performance.

const SUGGEST_PROMPT = `You are a knowledgeable, safety-conscious fitness coach. The user is about to log a workout. You have:
- Their personal context: age, current weight, recent weight trend, latest blood pressure reading (if any), and their daily goals.
- Their past history for THIS specific activity (either a named exercise's sets/reps/weight, or recent sessions of this training type).

Write ONE short, specific, actionable suggestion (1-2 sentences, under 35 words) for today's session. Use concrete numbers from history when available (e.g. a weight/rep target to beat, a pace or duration goal). Factor in personal context sensibly — e.g. suggest a more moderate pace/intensity if blood pressure has been running high, or note age-appropriate pacing — but do not give medical advice or diagnose anything, just practical, encouraging fitness guidance. If there's no history at all for this activity, give a brief, encouraging note to start conservatively and track it.

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
    const { trainingType, exerciseName, history, profile } = body;
    if (!trainingType && !exerciseName) {
      return new Response(JSON.stringify({ error: 'bad_request', message: 'trainingType or exerciseName is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const activityLabel = exerciseName ? `Exercise: ${exerciseName}` : `Training type: ${trainingType}`;
    const contextText = `${activityLabel}\n\nPersonal context:\n${JSON.stringify(profile || {})}\n\nPast history for this activity (most recent first):\n${JSON.stringify(history || [])}`;
    const parts = [{ text: SUGGEST_PROMPT + '\n\n' + contextText }];

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
