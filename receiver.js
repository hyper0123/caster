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

    // 3. Configuración mejorada de Shaka para evitar buffering infinito
    try {
      if (shakaPlayer && shakaPlayer.configure) {
        shakaPlayer.configure({
          streaming: {
            bufferingGoal: 20,
            rebufferingGoal: 5,
            bufferBehind: 30,
            ignoreTextStreamFailures: true,
            failureCallback: (error) => {
              showError(`Error de streaming: ${error.message}`);
            },
            retryParameters: {
              maxAttempts: 5,
              baseDelay: 1000,
              backoffFactor: 2,
              timeout: 10000  // 10 segundos de timeout por solicitud
            }
          },
          manifest: {
            defaultPresentationDelay: 10,
            retryParameters: {
              maxAttempts: 4
            }
          }
        });
        updateStatus('Shaka configurado correctamente');
      }
    } catch (configError) {
      console.warn(`Advertencia de configuración: ${configError.message}`);
    }

    // 4. Opciones del receptor con configuración mejorada
    const options = new cast.framework.CastReceiverOptions();
    options.disableIdleTimeout = true;
    options.maxInactivity = 3600;
    options.playbackConfig = new cast.framework.PlaybackConfig();
    options.playbackConfig.autoResumeDuration = 5;
    options.useShakaForHls = true;
    options.shakaVersion = '4.7.10';

    // 5. Manejo de redirecciones mejorado
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
            
            // Headers problemáticos para redirecciones
            delete newRequest.headers['Range'];
            delete newRequest.headers['Origin'];
            delete newRequest.headers['Referer'];
            
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

    // 7. Interceptor de carga - CON SOLUCIÓN A "NO SE RECIBIÓ CONTENIDO"
    playerManager.setMessageInterceptor(
      cast.framework.messages.MessageType.LOAD,
      loadRequestData => {
        // Cancelar timeout de espera
        clearTimeout(loadTimeout);
        
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
          
          if (cd.url) {
            media.contentUrl = cd.url;
          } else if (cd.contentUrl) {
            media.contentUrl = cd.contentUrl;
          }
          
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
        if (!media.contentType) {
          // Determinar tipo por extensión si no está especificado
          if (media.contentUrl.includes('.m3u8')) {
            media.contentType = 'application/x-mpegurl';
          } else if (media.contentUrl.includes('.mpd')) {
            media.contentType = 'application/dash+xml';
          } else if (media.contentUrl.includes('.mp4')) {
            media.contentType = 'video/mp4';
          }
        }
        
        // 4. Actualizar UI
        updateStatus(`Cargando: ${media.contentUrl.substring(0, 60)}...`);
        
        return loadRequestData;
      }
    );

    // 8. Configuración de DRM y headers - SOLUCIÓN A BUFFERING INFINITO
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
      
      // Función para añadir headers esenciales
      const addEssentialHeaders = (req, customHeaders = {}) => {
        if (!req.headers) req.headers = {};
        
        // Headers esenciales para evitar problemas de buffering
        const essentialHeaders = {
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
          'Accept': '*/*',
          'Accept-Encoding': 'identity;q=1, *;q=0',
          'Connection': 'keep-alive',
          'Range': 'bytes=0-' // Evitar rangos parciales problemáticos
        };
        
        // Combinar headers
        req.headers = {
          ...essentialHeaders,
          ...customHeaders
        };
      };
      
      // Aplicar headers según el tipo
      if (cd.licenseHeaders) {
        playbackConfig.licenseRequestHandler = req => {
          addEssentialHeaders(req, cd.licenseHeaders);
          return req;
        };
      }
      
      if (cd.manifestHeaders) {
        playbackConfig.manifestRequestHandler = req => {
          addEssentialHeaders(req, cd.manifestHeaders);
        };
      }
      
      if (cd.segmentHeaders) {
        playbackConfig.segmentRequestHandler = req => {
          addEssentialHeaders(req, cd.segmentHeaders);
        };
      }
      
      return playbackConfig;
    });

    // 9. Eventos de estado - DETECCIÓN DE ERRORES DE BUFFERING
    playerManager.addEventListener(
      cast.framework.events.EventType.MEDIA_STATUS,
      evt => {
        if (!evt || !evt.mediaStatus) return;
        
        const playerState = evt.mediaStatus.playerState;
        updateStatus(`Estado: ${playerState}`);
        
        if (playerState === 'PLAYING') {
          if (errorDisplay) errorDisplay.style.display = 'none';
        } else if (playerState === 'BUFFERING') {
          // Iniciar timeout para buffering prolongado
          bufferingTimeout = setTimeout(() => {
            showError('Buffering prolongado. Verifique conexión o contenido');
          }, 15000);
        } else if (playerState === 'IDLE') {
          clearTimeout(bufferingTimeout);
          if (evt.mediaStatus.idleReason) {
            showError(`Razón de inactividad: ${evt.mediaStatus.idleReason}`);
          }
        }
      }
    );

    // 10. Escuchar errores de Shaka
    shakaPlayer.addEventListener('error', (event) => {
      clearTimeout(bufferingTimeout);
      const error = event.detail;
      let errorMessage = 'Error desconocido de Shaka';
      
      if (error) {
        // Mensajes de error específicos para problemas comunes
        switch (error.code) {
          case 1003: // NETWORK_ERROR
            errorMessage = 'Error de red. Verifique conexión';
            break;
          case 1005: // MEDIA_SOURCE_OPERATION_FAILED
            errorMessage = 'Error en decodificación de video';
            break;
          case 1016: // UNSUPPORTED_FORMAT
            errorMessage = 'Formato no soportado';
            break;
          case 1022: // LICENSE_RESPONSE_REJECTED
            errorMessage = 'Licencia DRM rechazada';
            break;
          default:
            errorMessage = `Código: ${error.code}, ${error.message}`;
        }
      }
      
      showError(`Error de Shaka: ${errorMessage}`);
    });

    // 11. Evento de error general
    playerManager.addEventListener(
      cast.framework.events.EventType.ERROR,
      event => {
        clearTimeout(bufferingTimeout);
        const errorMsg = event.detailedError || event.error || 'Error desconocido';
        
        // Manejar errores específicos del receptor
        if (errorMsg.includes('LOAD_FAILED') || errorMsg.includes('MEDIA_ERROR')) {
          showError('Error al cargar contenido. Verifique URL y headers');
        } else if (errorMsg.includes('IDLE')) {
          showError('El receptor entró en estado inactivo');
        } else {
          showError(`Error del receptor: ${errorMsg}`);
        }
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

    // 13. Timeout para "No se recibió contenido"
    let loadTimeout = setTimeout(() => {
      if (statusElement && statusElement.innerText.includes('Esperando contenido')) {
        showError('No se recibió contenido. Posibles causas:\n' + 
                  '1. Dispositivo sender no conectado\n' +
                  '2. Problema de red entre sender y receptor\n' +
                  '3. La aplicación sender no está enviando contenido');
      }
    }, 15000); // 15 segundos

    // 14. Timeout para buffering prolongado
    let bufferingTimeout;
    
    // Cancelar timeout si se comienza a reproducir
    playerManager.addEventListener(
      cast.framework.events.EventType.MEDIA_STATUS,
      (evt) => {
        if (evt.mediaStatus.playerState === 'PLAYING') {
          clearTimeout(bufferingTimeout);
        }
      }
    );
    
  } catch (globalError) {
    showError(`Error crítico: ${globalError.message}`);
    console.error('Error en receptor:', globalError);
  }
});
