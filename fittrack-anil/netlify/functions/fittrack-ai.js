import OpenAI from 'openai';

const MAX_USER_MESSAGE = 2000;
const MAX_HISTORY = 12;

const SYSTEM_PROMPT = `Sen FitTrack adlı fitness takip uygulamasının akıllı asistanısın.
Kullanıcının verdiği kalori, su, egzersiz, kilo, BMI ve haftalık aktivite verilerine göre yardımcı ol.
Kısa, anlaşılır ve motive edici cevap ver.
Tıbbi teşhis koyma.
Doktor veya diyetisyen gibi kesin konuşma; genel sağlıklı yaşam önerileri ver.
Kullanıcı çok riskli bir sağlık sorusu sorarsa (akut ağrı, göğüs ağrısı, bayılma, intihar, yeme bozukluğu krizi vb.) acil servis veya uygun profesyonel destek almasını öner.
Cevapları Türkçe ver.
Cevap formatı mümkünse şu başlıklarla yapılandır:
- Durum
- Öneri
- Motivasyon

BMI ve skorlar yalnızca genel takip amaçlıdır; kişisel tıbbi yorum yapma.`;

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8'
    },
    body: JSON.stringify(payload)
  };
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Yalnızca POST desteklenir.' });
  }

  if (!process.env.OPENAI_API_KEY) {
    return jsonResponse(503, {
      error: 'Sunucuda OPENAI_API_KEY tanımlı değil. Netlify ortam değişkenlerini kontrol edin.'
    });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return jsonResponse(400, { error: 'Geçersiz JSON gövdesi.' });
  }

  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) {
    return jsonResponse(400, { error: 'Mesaj boş olamaz.' });
  }
  if (message.length > MAX_USER_MESSAGE) {
    return jsonResponse(400, {
      error: 'Mesaj çok uzun; en fazla ' + MAX_USER_MESSAGE + ' karakter gönderin.'
    });
  }

  const fitnessData =
    body.fitnessData && typeof body.fitnessData === 'object' && !Array.isArray(body.fitnessData)
      ? body.fitnessData
      : {};

  let chatHistory = [];
  if (Array.isArray(body.chatHistory)) {
    chatHistory = body.chatHistory
      .filter(function (m) {
        return (
          m &&
          (m.role === 'user' || m.role === 'assistant') &&
          typeof m.content === 'string' &&
          m.content.trim()
        );
      })
      .map(function (m) {
        return {
          role: m.role,
          content: m.content.trim().slice(0, MAX_USER_MESSAGE)
        };
      })
      .slice(-MAX_HISTORY);
  }

  let fitnessJson;
  try {
    fitnessJson = JSON.stringify(fitnessData);
  } catch {
    fitnessJson = '{}';
  }

  const systemWithData =
    SYSTEM_PROMPT +
    '\n\nAşağıdaki JSON, kullanıcının güncel FitTrack özeti ve haftalık toplamlarıdır (sayıları cevapta anlamlı şekilde kullan):\n' +
    fitnessJson;

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const messages = [{ role: 'system', content: systemWithData }].concat(
      chatHistory.map(function (m) {
        return { role: m.role, content: m.content };
      }),
      [{ role: 'user', content: message }]
    );

    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      max_tokens: 900,
      temperature: 0.65
    });

    const reply = (completion.choices[0] && completion.choices[0].message && completion.choices[0].message.content
      ? String(completion.choices[0].message.content).trim()
      : '') || '';

    if (!reply) {
      return jsonResponse(502, { error: 'Model boş yanıt döndü.' });
    }

    return jsonResponse(200, { reply });
  } catch (err) {
    console.error('fittrack-ai OpenAI error:', err);
    const msg =
      err && typeof err.message === 'string'
        ? err.message
        : 'OpenAI isteği sırasında beklenmeyen bir hata oluştu.';
    return jsonResponse(502, { error: msg });
  }
};
