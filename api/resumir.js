// POST { texto } -> { resumen: string[] }
// Llama a Gemini para generar un resumen real de 2-3 puntos clave.
// La API key vive solo en el servidor (process.env.GEMINI_API_KEY).

const MODEL = process.env.GEMINI_MODEL || 'gemini-3-flash-preview';

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY no configurada');
    res.status(500).json({ error: 'missing_api_key' });
    return;
  }

  const { texto } = req.body || {};
  if (!texto || typeof texto !== 'string' || !texto.trim()) {
    res.status(400).json({ error: 'texto_requerido' });
    return;
  }

  const prompt =
    'Eres un asistente que resume notas de voz personales. Resume el siguiente texto en 2 a 3 puntos ' +
    'clave, breves y claros, en español. Cada punto debe ser una frase completa y autónoma (no uses ' +
    'numeración ni viñetas, eso se agrega aparte). No inventes información que no esté en el texto.\n\n' +
    'TEXTO:\n' + texto;

  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: { type: 'ARRAY', items: { type: 'STRING' } },
            temperature: 0.4,
          },
        }),
      }
    );

    if (!r.ok) {
      const errText = await r.text().catch(() => '');
      console.error('Gemini resumir error', r.status, errText);
      res.status(502).json({ error: 'gemini_error' });
      return;
    }

    const data = await r.json();
    const raw =
      data &&
      data.candidates &&
      data.candidates[0] &&
      data.candidates[0].content &&
      data.candidates[0].content.parts &&
      data.candidates[0].content.parts[0] &&
      data.candidates[0].content.parts[0].text;

    if (!raw) {
      console.error('Gemini resumir: respuesta vacia', JSON.stringify(data).slice(0, 500));
      res.status(502).json({ error: 'empty_response' });
      return;
    }

    let resumen;
    try {
      resumen = JSON.parse(raw);
    } catch (e) {
      resumen = raw.split('\n').map((s) => s.trim()).filter(Boolean);
    }
    if (!Array.isArray(resumen)) resumen = [String(resumen)];
    resumen = resumen.map((s) => String(s).trim()).filter(Boolean).slice(0, 3);

    if (!resumen.length) {
      res.status(502).json({ error: 'empty_summary' });
      return;
    }

    res.status(200).json({ resumen });
  } catch (e) {
    console.error('Gemini resumir exception', e);
    res.status(500).json({ error: 'server_error' });
  }
};
