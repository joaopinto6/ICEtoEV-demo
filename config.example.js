// Copie este ficheiro para config.js e coloque a sua chave do Google AI Studio.
// Sem config.js a app funciona na mesma — só o relatório por IA fica desativado.
window.APP_CONFIG = {
  geminiApiKey: 'COLE_AQUI_A_SUA_CHAVE',
  geminiModel: 'gemini-3.1-flash-lite',
  geminiFallbackModel: 'gemini-3.5-flash-lite', // usado se o principal estiver sobrecarregado (503)
};
