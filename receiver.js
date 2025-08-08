document.addEventListener('DOMContentLoaded', function() {
  // Elementos DOM
  const videoElement = document.getElementById('video');
  const statusElement = document.getElementById('status');
  const errorDisplay = document.getElementById('errorDisplay');
  const loadingOverlay = document.getElementById('loadingOverlay');
  
  // Función para mostrar errores
  function showError(message) {
    console.error('ERROR:', message);
    if (errorDisplay) {
      errorDisplay.textContent = `ERROR: ${message}`;
      errorDisplay.style.display = 'block';
    }
    if (statusElement) statusElement.innerText = 'Error detectado';
    if (loadingOverlay) loadingOverlay.style.display = 'none';
  }

  // Función para actualizar estado
  function updateStatus(message) {
    console.log(message);
    if (statusElement) {
      statusElement.innerText = message;
    }
  }

  // 1. Verificar que los frameworks están cargados
  if (!window.cast || !window.cast.framework) {
    showError('Cast Framework no está cargado');
    return;
  }

  if (!window.shaka) {
    showError('Shaka Player no está cargado');
    return;
  }

  try {
    const context = cast.framework.CastReceiverContext.getInstance();
    const playerManager = context.getPlayerManager();
    
    updateStatus('Contexto del receptor obtenido');
    
    // 2. Crear instancia de Shaka Player
    let shakaPlayer;
    try {
      shakaPlayer = new shaka.Player(videoElement);
      updateStatus('Shaka Player inicializado');
    } catch (playerError) {
      showError(`Error al crear Shaka Player: ${playerError.message}`);
      return;
    }

    // 3. Configuración básica de Shaka
    try {
      if (shakaPlayer && shakaPlayer.configure) {
        // Configuración mínima y segura
        shakaPlayer.configure({
          streaming: {
            rebufferingGoal: 10,  // Objetivo de buffering en segundos
            bufferingGoal: 20,     // Buffer completo en segundos
            retryParameters: {
              maxAttempts: 5,     // Más reintentos para conexiones lentas
              baseDelay: 1000,
              backoffFactor: 2
            }
          }
        });
        updateStatus('Shaka configurado correctamente');
      }
    } catch (configError) {
      console.warn(`Advertencia de configuración: ${configError.message}`);
    }

    // 4. Opciones del receptor
    const options = new cast.framework.CastReceiverOptions();
    options.disableIdleTimeout = true;
    options.maxInactivity = 3600;
    options.playbackConfig = new cast.framework.PlaybackConfig();
    options.useShakaForHls = true;
    options.shakaVersion = '4.7.10';

    // 5. Manejo de redirecciones
    if (shakaPlayer.getNetworkingEngine) {
      shakaPlayer.getNetworkingEngine().registerResponseFilter(function(type, response) {
        if (response && response.status >= 300 && response.status < 400 && response.headers && response.headers['location']) {
          try {
            const newUrl = new URL(response.headers['location'], response.request.uris[0]).href;
            updateStatus(`Redirigiendo a: ${newUrl}`);
            
            // Crear nueva solicitud
            const newRequest = {
              method: response.request.method,
              uris: [newUrl],
              headers: {...response.request.headers},
              body: response.request.body
            };
            
            // Eliminar headers que pueden causar problemas en redirecciones
            delete newRequest.headers['Range'];
            delete newRequest.headers['Origin'];
            
            return shakaPlayer.getNetworkingEngine().request(type, newRequest);
          } catch (error) {
            showError(`Error en redirección: ${error.message}`);
          }
        }
        return response;
      });
    }

    // 6. URL de fallback
    const fallbackURL = 'https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';

    // 7. Interceptor de carga MEJORADO
    playerManager.setMessageInterceptor(
      cast.framework.messages.MessageType.LOAD,
      loadRequestData => {
        updateStatus('LOAD recibido. Procesando...');
        if (loadingOverlay) loadingOverlay.style.display = 'none';
        
        if (!loadRequestData || !loadRequestData.media) {
          showError('Solicitud de carga inválida');
          return new cast.framework.messages.ErrorData(
            cast.framework.messages.ErrorType.LOAD_FAILED
          );
        }
        
        const media = loadRequestData.media;
        
        // 1. Manejar customData
        if (media.customData) {
          const cd = media.customData;
          
          // Prioridad: url > contentUrl > media.contentUrl existente
          if (cd.url) {
            media.contentUrl = cd.url;
          } else if (cd.contentUrl) {
            media.contentUrl = cd.contentUrl;
          }
          
          // Tipo de contenido
          if (cd.contentType) {
            media.contentType = cd.contentType;
          }
        }
        
        // 2. Verificar si tenemos URL
        if (!media.contentUrl) {
          media.contentUrl = fallbackURL;
          media.contentType = 'video/mp4';
          updateStatus('Usando contenido por defecto');
        }
        
        // 3. Verificar compatibilidad
        if (media.contentType) {
          if (media.contentType.includes('mpegurl') && !shaka.Player.isTypeSupported('application/vnd.apple.mpegurl')) {
            showError('HLS no soportado en este dispositivo');
          } else if (media.contentType.includes('dash') && !shaka.Player.isTypeSupported('application/dash+xml')) {
            showError('DASH no soportado');
          }
        }
        
        // 4. Actualizar UI
        updateStatus(`Cargando: ${media.contentUrl.substring(0, 60)}...`);
        
        // 5. Asegurar que la URL es válida
        try {
          new URL(media.contentUrl);
        } catch (e) {
          showError(`URL inválida: ${media.contentUrl}`);
          media.contentUrl = fallbackURL;
        }
        
        return loadRequestData;
      }
    );

    // 8. Configuración de DRM y headers - VERSIÓN ROBUSTA
    playerManager.setMediaPlaybackInfoHandler((loadReq, playbackConfig) => {
      updateStatus('Configurando DRM y headers...');
      
      if (!loadReq || !loadReq.media) {
        return playbackConfig;
      }
      
      const cd = loadReq.media.customData || {};
      
      // Configuración de DRM
      if (cd.licenseUrl) {
        playbackConfig.licenseUrl = cd.licenseUrl;
        playbackConfig.protectionSystem = 
          cd.licenseType === 'clearKey' 
            ? cast.framework.ContentProtection.CLEARKEY 
            : cast.framework.ContentProtection.WIDEVINE;
      }
      
      // Función para añadir headers
      const addHeaders = (req, headers) => {
        if (!req.headers) req.headers = {};
        
        // Combinar headers
        req.headers = {
          ...req.headers,
          ...headers,
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
          'Accept': '*/*',
          'Connection': 'keep-alive'
        };
      };
      
      // Aplicar headers según el tipo
      if (cd.licenseHeaders) {
        playbackConfig.licenseRequestHandler = req => {
          addHeaders(req, cd.licenseHeaders);
          return req;
        };
      }
      
      if (cd.manifestHeaders) {
        playbackConfig.manifestRequestHandler = req => {
          addHeaders(req, cd.manifestHeaders);
        };
      }
      
      if (cd.segmentHeaders) {
        playbackConfig.segmentRequestHandler = req => {
          addHeaders(req, cd.segmentHeaders);
        };
      }
      
      return playbackConfig;
    });

    // 9. Eventos de estado - CON MÁS DETALLES
    playerManager.addEventListener(
      cast.framework.events.EventType.MEDIA_STATUS,
      evt => {
        if (!evt || !evt.mediaStatus) return;
        
        updateStatus(`Estado: ${evt.mediaStatus.playerState}`);
        
        if (evt.mediaStatus.playerState === 'PLAYING') {
          if (errorDisplay) errorDisplay.style.display = 'none';
        } else if (evt.mediaStatus.playerState === 'BUFFERING') {
          updateStatus('Buffering...');
        }
        
        // Detectar problemas de carga
        if (evt.mediaStatus.idleReason) {
          showError(`Razón de inactividad: ${evt.mediaStatus.idleReason}`);
        }
      }
    );

    // 10. Escuchar errores de Shaka
    shakaPlayer.addEventListener('error', (event) => {
      const error = event.detail;
      const errorMessage = error ? `Código: ${error.code}, ${error.message}` : 'Error desconocido de Shaka';
      showError(`Error de Shaka: ${errorMessage}`);
    });

    // 11. Evento de error general
    playerManager.addEventListener(
      cast.framework.events.EventType.ERROR,
      event => {
        const errorMsg = event.detailedError || event.error || 'Error desconocido';
        showError(`Error del receptor: ${errorMsg}`);
      }
    );

    // 12. Iniciar el receptor
    try {
      context.start(options);
      updateStatus('Receptor listo. Esperando contenido...');
      if (loadingOverlay) loadingOverlay.style.display = 'none';
    } catch (startError) {
      showError(`Error al iniciar receptor: ${startError.message}`);
    }

    // 13. Timeout de seguridad - PARA DETECTAR SI NO LLEGA CONTENIDO
    let loadTimeout = setTimeout(() => {
      if (statusElement && statusElement.innerText.includes('Esperando contenido')) {
        showError('No se recibió contenido. Verifique el sender.');
      }
    }, 15000); // 15 segundos

    // Cancelar timeout si se recibe contenido
    playerManager.addEventListener(
      cast.framework.events.EventType.MEDIA_STATUS,
      () => {
        clearTimeout(loadTimeout);
      }
    );
    
  } catch (globalError) {
    showError(`Error crítico: ${globalError.message}`);
    console.error('Error en receptor:', globalError);
  }
});
