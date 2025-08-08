// receiver.js
(() => {
  const context       = cast.framework.CastReceiverContext.getInstance();
  const playerManager = context.getPlayerManager();
  const video         = document.getElementById('video');
  const statusLabel   = document.getElementById('status');

  // Muestra mensajes breves
  function showMessage(text, duration = 3000) {
    statusLabel.textContent = text;
    setTimeout(() => statusLabel.textContent = '', duration);
  }

  // Inicializa Shaka
  const shakaPlayer = new shaka.Player(video);
  shaka.log.setLevel(shaka.log.Level.V1);

  // 1) ResponseFilter para seguir redirecciones 3xx (CORS-problemático)
  shakaPlayer.getNetworkingEngine().registerResponseFilter((type, response) => {
    if (response.status >= 300 && response.status < 400 && response.headers['location']) {
      return fetch(response.headers['location'], {
        method: response.request.method,
        headers: response.request.headers,
        body:    response.request.body
      }).then(r => r);
    }
  });

  // 2) Fallback en caso de error de Shaka
  shakaPlayer.addEventListener('error', evt => {
    console.error('Shaka error:', evt.detail);
    showMessage('Error de reproducción, cargando demo');
    playFallback();
  });
  function playFallback() {
    const demoUrl = 'https://storage.googleapis.com/shaka-demo-assets/angel-one/dash.mpd';
    shakaPlayer.load(demoUrl)
      .then(() => showMessage('Demo reproduciéndose'))
      .catch(err => console.error('Fallback error:', err));
  }

  // 3) Interceptor LOAD para customData + headers + DRM + fallback
  playerManager.setMessageInterceptor(
    cast.framework.messages.MessageType.LOAD,
    loadReq => {
      try {
        const media = loadReq.media;
        if (!media) throw new Error('No media');

        showMessage('Video recibido');
        playerManager.setMediaElement(video);

        // Extrae customData enviado desde la app Android
        const extras = media.requestMetadata?.extras || {};
        const data   = JSON.parse(extras.customData || '{}');
        const { mediaUrl, headers = {}, licenseType, licenseKey } = data;

        // 3.1) Inyecta headers en TODAS las peticiones (manifiesto, segmentos, licencia)
        const ne = shakaPlayer.getNetworkingEngine();
        ne.registerRequestFilter((type, request) => {
          Object.entries(headers).forEach(([k,v]) => request.headers[k] = v);
        });

        // 3.2) Configura DRM
        const drmConfig = {};
        if (licenseType && licenseKey) {
          if (licenseType.toLowerCase().includes('clearkey')) {
            drmConfig.clearKeys = {};
            if (licenseKey.trim().startsWith('{')) {
              JSON.parse(licenseKey).keys.forEach(k => drmConfig.clearKeys[k.kid] = k.k);
            } else {
              const [kidHex,keyHex] = licenseKey.split(':');
              const kidB64 = shaka.util.Uint8ArrayUtils.toBase64String(shaka.util.Hex.getBytes(kidHex));
              const keyB64 = shaka.util.Uint8ArrayUtils.toBase64String(shaka.util.Hex.getBytes(keyHex));
              drmConfig.clearKeys[kidB64] = keyB64;
            }
          } else {
            drmConfig.servers = { 'com.widevine.alpha': licenseKey };
          }
        }
        shakaPlayer.configure({ drm: drmConfig });

        // 3.3) Carga y reproduce
        if (!mediaUrl) throw new Error('mediaUrl missing');
        shakaPlayer.load(mediaUrl)
          .then(() => console.log('Reproduciendo', mediaUrl))
          .catch(err => { console.error('Load failed', err); showMessage('Fallo, demo'); playFallback(); });
      } catch (e) {
        console.error('Interceptor error:', e);
        showMessage('Datos inválidos, demo');
        playFallback();
      }
      // Devuelve null para evitar UI nativa de CAF
      return null;
    }
  );

  // 4) Nota CORS: los servidores de manifiesto y de licencia deben exponer:
  //    Access-Control-Allow-Origin: *
  //    Access-Control-Allow-Methods: GET, POST, OPTIONS
  //    Access-Control-Allow-Headers: <los encabezados que uses>

  context.setTimeout(60000);  // Espera hasta 60s antes de desconectar
  context.start();
})();
