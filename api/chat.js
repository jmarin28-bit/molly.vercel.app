// POST { texto, pregunta, historial } -> { respuesta: string }
// Llama a Gemini para responder preguntas sobre la nota, usando el historial
// de la conversación como contexto. La API key vive solo en el servidor.

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

  const { texto, pregunta, historial } = req.body || {};
  if (!texto || typeof texto !== 'string' || !texto.trim()) {
    res.status(400).json({ error: 'texto_requerido' });
    return;
  }
  if (!pregunta || typeof pregunta !== 'string' || !pregunta.trim()) {
    res.status(400).json({ error: 'pregunta_requerida' });
    return;
  }

  const systemInstruction =
    'Eres Molly, la asistente de una app de notas de voz. Responde SOLO con base en el texto de la nota ' +
    'que se te da a continuación. Si la respuesta no está en el texto, dilo claramente en vez de inventar ' +
    'información. Responde en español, de forma breve, natural y conversacional.\n\n' +
    'TEXTO DE LA NOTA:\n' + texto;

  const contents = [];
  if (Array.isArray(historial)) {
    for (const turno of historial) {
      if (!turno || typeof turno.text !== 'string' || !turno.text.trim()) continue;
      const role = turno.role === 'model' ? 'model' : 'user';
      contents.push({ role, parts: [{ text: turno.text }] });
    }
  }
  contents.push({ role: 'user', parts: [{ text: pregunta }] });

  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents,
          generationConfig: { temperature: 0.5 },
        }),
      }
    );

    if (!r.ok) {
      const errText = await r.text().catch(() => '');
      console.error('Gemini chat error', r.status, errText);
      res.status(502).json({ error: 'gemini_error' });
      return;
    }

    const data = await r.json();
    const respuesta =
      data &&
      data.candidates &&
      data.candidates[0] &&
      data.candidates[0].content &&
      data.candidates[0].content.parts &&
      data.candidates[0].content.parts[0] &&
      data.candidates[0].content.parts[0].text;

    if (!respuesta || !respuesta.trim()) {
      console.error('Gemini chat: respuesta vacia', JSON.stringify(data).slice(0, 500));
      res.status(502).json({ error: 'empty_response' });
      return;
    }

    res.status(200).json({ respuesta: respuesta.trim() });
  } catch (e) {
    console.error('Gemini chat exception', e);
    res.status(500).json({ error: 'server_error' });
  }
};
