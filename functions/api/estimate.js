// Cloudflare Pages Function — POST /api/estimate
// Calls Google Gemini (free tier) to estimate macros from either a text
// description of food(s) or a food photo. Returns { foods: [...] }.
//
// Requires an environment variable GEMINI_API_KEY to be set in the
// Cloudflare Pages project (Settings -> Environment variables).

const HYDRATION_RULE = `For each food item, also determine if it is a hydrating drink. Hydrating drinks include: water, unsweetened tea, coffee, sparkling water, and diet soda. NOT hydrating: alcohol, and drinks that are really food (milkshakes, protein shakes — these are already counted as food macros). If a food item is a hydrating drink, include a "hydrationOz" field with your best estimate of its volume in fluid ounces. Omit "hydrationOz" entirely for non-drink or non-hydrating items.`;

const PROMPT_TEXT = `You are a nutrition estimator. The user will describe one or more foods they ate, possibly including brand names and restaurant items. Identify each distinct food item and estimate its nutrition.

${HYDRATION_RULE}

Respond with ONLY valid JSON (no markdown, no commentary), in this exact shape:
{"foods":[{"name":"string","protein":number,"carbs":number,"fiber":number,"fat":number,"calories":number,"hydrationOz":number}]}

All numeric values are grams (protein, carbs, fiber, fat) or kcal (calories), for the full portion described. If the user gives a quantity or size, use it. If unsure of an exact branded product, give your best reasonable estimate rather than refusing.`;

const PROMPT_PHOTO = `You are a nutrition estimator. Look at this photo of a meal or food item and identify each distinct food you can see, estimating a realistic portion size for each.

${HYDRATION_RULE}

Respond with ONLY valid JSON (no markdown, no commentary), in this exact shape:
{"foods":[{"name":"string","protein":number,"carbs":number,"fiber":number,"fat":number,"calories":number,"hydrationOz":number}]}

All numeric values are grams (protein, carbs, fiber, fat) or kcal (calories), for the estimated portion shown. Give your best reasonable estimate rather than refusing.`;

const PROMPT_RECEIPT = `You are a nutrition estimator. Look at this photo of a single fast-food restaurant receipt and identify each distinct menu item purchased, matching it to that restaurant's known menu where possible.

Respond with ONLY valid JSON (no markdown, no commentary), in this exact shape:
{"foods":[{"name":"string","protein":number,"carbs":number,"fiber":number,"fat":number,"calories":number}]}

All numeric values are grams (protein, carbs, fiber, fat) or kcal (calories), for one serving of that item as sold. Ignore non-food line items (tax, tip, fees, drinks with no nutrition relevance only if truly ambiguous). This is a single fast-food meal receipt, not a grocery receipt — give your best reasonable estimate for each item rather than refusing.`;

const PROMPT_WORKOUT = `You are reading a screenshot of an Apple Watch or Fitness app workout summary screen. Extract the workout data shown.

Respond with ONLY valid JSON (no markdown, no commentary), in this exact shape:
{"type":"string","duration":number,"distance":number,"activeCalories":number,"avgHeartRate":number,"avgSpeed":number,"cadence":number}

"type" should be one of: Strength, Cardio, Walk, Cycling, Mobility, Mixed — pick the closest match to the workout type shown. duration is in minutes, distance in miles, activeCalories in kcal, avgHeartRate in bpm, avgSpeed in mph, cadence in rpm. Omit or use 0 for any field not shown on screen. Give your best reading of the numbers rather than refusing.`;

function extractJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON found in model response');
  return JSON.parse(match[0]);
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'not_configured', message: 'GEMINI_API_KEY is not set on this Cloudflare Pages project yet.' }), { status: 501, headers: { 'Content-Type': 'application/json' } });
    }

    const body = await request.json();
    const mode = body.mode; // 'text' | 'photo'
    let parts;

    if (mode === 'text') {
      if (!body.text || !body.text.trim()) {
        return new Response(JSON.stringify({ error: 'bad_request', message: 'No text provided.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }
      parts = [{ text: PROMPT_TEXT + '\n\nUser described: ' + body.text }];
    } else if (mode === 'photo' || mode === 'receipt' || mode === 'workout_photo') {
      if (!body.image) {
        return new Response(JSON.stringify({ error: 'bad_request', message: 'No image provided.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }
      // body.image is a data URL like "data:image/jpeg;base64,...."
      const match = body.image.match(/^data:(image\/[a-zA-Z]+);base64,(.*)$/);
      if (!match) {
        return new Response(JSON.stringify({ error: 'bad_request', message: 'Image must be a base64 data URL.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }
      const promptText = mode === 'receipt' ? PROMPT_RECEIPT : mode === 'workout_photo' ? PROMPT_WORKOUT : PROMPT_PHOTO;
      parts = [
        { text: promptText },
        { inline_data: { mime_type: match[1], data: match[2] } },
      ];
    } else {
      return new Response(JSON.stringify({ error: 'bad_request', message: 'mode must be "text", "photo", "receipt", or "workout_photo".' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`;
    const geminiRes = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { temperature: 0.2 },
      }),
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      return new Response(JSON.stringify({ error: 'gemini_error', message: errText.slice(0, 500) }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    }

    const geminiJson = await geminiRes.json();
    const text = geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const parsed = extractJson(text);

    if (mode !== 'workout_photo' && !Array.isArray(parsed.foods)) throw new Error('Malformed response shape');

    return new Response(JSON.stringify(parsed), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'server_error', message: String(e && e.message || e) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
