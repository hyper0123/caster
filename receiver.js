// receiver.js (mejorado)
(() => {
  // Cargas necesarias ya en index.html:
  //  - mux.js (para HLS TS -> fMP4 transmux)
  //  - shaka-player
  //  - cast_receiver_framework

  'use strict';
  const context = cast.framework.CastReceiverContext.getInstance();
  const playerManager = context.getPlayerManager();
  const video = document.getElementById('video');
  const overlay = document.getElementById('messageOverlay');

  function showMessage(text, time=4000) {
    overlay.textContent = text;
    overlay.style.display = 'block';
    setTimeout(()=> overlay.style.display='none', time);
  }

  // Instancia Shaka
  shaka.polyfill.installAll();
  const shakaPlayer = new shaka.Player(video);
  shaka.log.setLevel(shaka.log.Level.V1);

  // Configs de robustez
  shakaPlayer.configure({
    drm: { advanced: {} },
    streaming: {
      retryParameters: { maxAttempts: 5, baseDelay: 1.0, backoffFactor: 2.0 }
    },
    manifest: { dash: { ignoreDrmInfo: false } }
  });

  // Si se necesita transmuxer para HLS/TS
  // Asegúrate de cargar mux.js en index.html antes de shaka-player
  if (shaka.util && shaka.util.Transmuxer) {
    // nothing to do; mux.js habilitará transmux en shaka internamente
  }

  // Manejo de errores global
  shakaPlayer.addEventListener('error', evt => {
    console.error('Shaka error:', evt.detail);
    showMessage('Error de reproducción en receptor. Cargando demo.')
    playFallback();
  });

  function playFallback() {
    const demo = 'https://storage.googleapis.com/shaka-demo-assets/angel-one/dash.mpd';
    shakaPlayer.load(demo).then(()=> showMessage('Demo reproduciéndose')).catch(e=> console.error('Fallback fail', e));
  }

  // Funcion para convertir hex kid->base64 (si recibes hex)
  function hexToBase64(hex) {
    if (!hex) return null;
    const bytes = hex.match(/.{1,2}/g).map(h => parseInt(h, 16));
    const arr = new Uint8Array(bytes);
    return btoa(String.fromCharCode(...arr)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  }

  // Interceptor del mensaje LOAD de CAF
  playerManager.setMessageInterceptor(cast.framework.messages.MessageType.LOAD, loadReq => {
    try {
      showMessage('Load request recibido');
      playerManager.setMediaElement(video);

      const extras = loadReq.media.requestMetadata?.extras || {};
      const customJson = extras.customData || extras.customdata || '{}';
      const data = JSON.parse(customJson);

      const mediaUrl = data.mediaUrl;
      const headers = data.headers || {};
      const licenseType = data.licenseType;
      const licenseKey = data.licenseKey;

      // registerRequestFilter: añadir headers en TODAS las peticiones (manifest, segment, license)
      const ne = shakaPlayer.getNetworkingEngine();
      ne.registerRequestFilter((type, request) => {
        // requestType: MANIFEST, SEGMENT, LICENSE, KEY, etc.
        for (const k in headers) {
          // Normalizamos el nombre
          request.headers[k] = headers[k];
        }
        // Si necesitas credenciales (cookies) habilítalas: request.allowCrossSiteCredentials = true;
      });

      // Configuración DRM: ClearKey o Widevine
      const drm = {};
      if (licenseType && licenseKey) {
        if (licenseType.toLowerCase().includes('clearkey')) {
          // caso: licenseKey puede ser JSON con keys o "kid:key" en hex
          try {
            if (licenseKey.trim().startsWith('{')) {
              const obj = JSON.parse(licenseKey);
              drm.clearKeys = {};
              (obj.keys || []).forEach(k => drm.clearKeys[k.kid] = k.k);
            } else {
              const [kidHex, keyHex] = licenseKey.split(':');
              const kidB64 = hexToBase64(kidHex);
              const keyB64 = hexToBase64(keyHex);
              drm.clearKeys = {};
              drm.clearKeys[kidB64] = keyB64;
            }
          } catch(e) {
            console.warn('ClearKey parse error', e);
          }
        } else {
          // Widevine: licenseKey as license URL (opcional: si necesitas headers personalizados los metes en requestFilter)
          drm.servers = { 'com.widevine.alpha': licenseKey };
        }
      }

      shakaPlayer.configure({ drm });

      // Carga y reproducción
      shakaPlayer.load(mediaUrl).then(() => {
        console.log('Reproduciendo en receptor:', mediaUrl);
        showMessage('Reproduciendo en la TV');
      }).catch(err=>{
        console.error('Shaka load failed', err);
        showMessage('Fallo en carga del video, demo en breve');
        playFallback();
      });

    } catch (e) {
      console.error('Error en interceptor LOAD', e);
      showMessage('Datos inválidos en sender');
      playFallback();
    }
    // Retornamos null para que CAF no intente usar su player nativo
    return null;
  });

  // Nota: los servidores deben responder CORS correctamente en manifiesto, segmentos y licencias.
  // Iniciar context
  context.setTimeout(60000);
  context.start();
})();
