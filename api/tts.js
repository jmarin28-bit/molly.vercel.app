// POST { texto } -> { audio: base64 (WAV), mimeType: 'audio/wav' }
// Llama al modelo TTS de Gemini y envuelve el PCM crudo que devuelve en un
// contenedor WAV para que el navegador lo pueda reproducir directamente.

const MODEL = process.env.GEMINI_TTS_MODEL || 'gemini-3.1-flash-tts-preview';
const VOICE = process.env.GEMINI_TTS_VOICE || 'Kore';

function pcmToWavBase64(pcmBase64, sampleRate, channels, bitsPerSample) {
  const pcm = Buffer.from(pcmBase64, 'base64');
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]).toString('base64');
}

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

  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: texto }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } },
          },
        }),
      }
    );

    if (!r.ok) {
      const errText = await r.text().catch(() => '');
      console.error('Gemini tts error', r.status, errText);
      res.status(502).json({ error: 'gemini_error' });
      return;
    }

    const data = await r.json();
    const part =
      data &&
      data.candidates &&
      data.candidates[0] &&
      data.candidates[0].content &&
      data.candidates[0].content.parts &&
      data.candidates[0].content.parts[0];
    const inline = part && part.inlineData;
    const pcmBase64 = inline && inline.data;

    if (!pcmBase64) {
      console.error('Gemini tts: sin audio', JSON.stringify(data).slice(0, 500));
      res.status(502).json({ error: 'empty_response' });
      return;
    }

    const mime = inline.mimeType || '';
    const rateMatch = /rate=(\d+)/.exec(mime);
    const channelsMatch = /channels=(\d+)/.exec(mime);
    const rate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;
    const channels = channelsMatch ? parseInt(channelsMatch[1], 10) : 1;

    const wavBase64 = pcmToWavBase64(pcmBase64, rate, channels, 16);
    res.status(200).json({ audio: wavBase64, mimeType: 'audio/wav' });
  } catch (e) {
    console.error('Gemini tts exception', e);
    res.status(500).json({ error: 'server_error' });
  }
};
