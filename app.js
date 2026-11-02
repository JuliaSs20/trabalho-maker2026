/**
 * BioPhysio AI - Interface de Captação e Interação (App Controller - Fase 2)
 */

document.addEventListener('DOMContentLoaded', () => {
  // Inicialização do Motor Biomecânico Unificado
  const analyzer = new TherapeuticExerciseAnalyzer("squat");
  
  // Elementos do DOM - Captação & Canvas
  const videoElement = document.getElementById('input-video');
  const canvasElement = document.getElementById('output-canvas');
  const canvasCtx = canvasElement.getContext('2d');
  const sourceSelect = document.getElementById('input-source-select');
  const exerciseSelect = document.getElementById('exercise-select');
  const videoFileInput = document.getElementById('video-file-input');

  // Elementos do DOM - IoT & Câmera
  const btnConnectSensor = document.getElementById('btn-connect-sensor');
  const cameraErrorBanner = document.getElementById('camera-error-banner');
  const cameraErrorMsg = document.getElementById('camera-error-msg');
  const btnRetryCamera = document.getElementById('btn-retry-camera');
  const statusText = document.getElementById('status-text');
  const statusDot = document.querySelector('#system-status .pulse-dot');
  
  // Elementos do DOM - Controles
  const btnStart = document.getElementById('btn-start-stream');
  const btnPause = document.getElementById('btn-pause-stream');
  const btnReset = document.getElementById('btn-reset-counters');
  const btnToggleVoice = document.getElementById('btn-toggle-voice');
  const chkNoiseFilter = document.getElementById('chk-noise-filter');
  
  // Elementos do DOM - HUD, Distância e Rastreamento de Paciente
  const hudPhaseText = document.getElementById('hud-phase-text');
  const hudKneeAngle = document.getElementById('hud-knee-angle');
  const hudAngleSub = document.getElementById('hud-angle-sub');
  const canvasDistanceToast = document.getElementById('canvas-distance-toast');
  const canvasDistanceMsg = document.getElementById('canvas-distance-msg');
  const canvasLockBadge = document.getElementById('canvas-lock-badge');
  const btnUnlockSubject = document.getElementById('btn-unlock-subject');

  const canvasWarningToast = document.getElementById('canvas-warning-toast');
  const canvasWarningMsg = document.getElementById('canvas-warning-msg');

  const patientFeedbackCard = document.getElementById('patient-feedback-card');
  const feedbackTag = document.getElementById('feedback-tag');
  const feedbackMainMsg = document.getElementById('feedback-main-msg');
  const feedbackIconContainer = document.getElementById('feedback-icon-container');

  const valKneeAngle = document.getElementById('val-knee-angle');
  const targetKneeAngle = document.getElementById('target-knee-angle');
  const barKneeFlexion = document.getElementById('bar-knee-flexion');
  const valTrunkAngle = document.getElementById('val-trunk-angle');
  const barTrunkAngle = document.getElementById('bar-trunk-angle');

  const valValgusStatus = document.getElementById('val-valgus-status');
  const indicatorValgus = document.getElementById('indicator-valgus');

  const valHeelStatus = document.getElementById('val-heel-status');
  const indicatorHeel = document.getElementById('indicator-heel');

  const repTotal = document.getElementById('rep-total');
  const repCorrect = document.getElementById('rep-correct');
  const repFaults = document.getElementById('rep-faults');

  const jsonStreamOutput = document.getElementById('json-stream-output');
  const btnCopyJson = document.getElementById('btn-copy-json');
  const btnDownloadSession = document.getElementById('btn-download-session');

  // Estado da Aplicação
  let isRunning = false;
  let animationFrameId = null;
  let voiceEnabled = true;
  let lastSpokenMessage = "";
  let lastSpeechTime = 0;
  let currentJSONProtocol = "";
  let sessionLogs = [];
  let sessionUsedBleSensor = false;

  // Estado do Motor MediaPipe Pose & Conexão de Mídia
  let poseEngine = null;
  let mediaStream = null;
  let isSendingFrame = false;
  let simTime = 0;

  const synth = window.speechSynthesis;

  function speakFeedback(msg) {
    if (!voiceEnabled || !synth) return;
    const now = Date.now();
    if (msg === lastSpokenMessage && now - lastSpeechTime < 5000) return;
    if (now - lastSpeechTime < 3000) return;

    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(msg);
    utterance.lang = 'pt-BR';
    utterance.rate = 1.05;
    synth.speak(utterance);

    lastSpokenMessage = msg;
    lastSpeechTime = now;
  }

  function resizeCanvas() {
    const wrapper = document.getElementById('canvas-wrapper');
    if (wrapper) {
      canvasElement.width = wrapper.clientWidth || 640;
      canvasElement.height = wrapper.clientHeight || 480;
    }
  }
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  function showCameraError(msg) {
    if (cameraErrorBanner) {
      cameraErrorMsg.textContent = msg;
      cameraErrorBanner.classList.remove('hidden');
    }
  }

  function hideCameraError() {
    if (cameraErrorBanner) {
      cameraErrorBanner.classList.add('hidden');
    }
  }

  function updateStatusText(text, dotColor = "green") {
    if (statusText) statusText.textContent = text;
    if (statusDot) {
      statusDot.className = `pulse-dot ${dotColor}`;
    }
  }

  function initPoseEngine() {
    if (poseEngine) return true;
    if (typeof window.Pose === 'undefined') {
      console.error("SDK do MediaPipe Pose não encontrado no window.");
      return false;
    }

    try {
      poseEngine = new window.Pose({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
      });

      poseEngine.setOptions({
        modelComplexity: 1,
        smoothLandmarks: true,
        enableSegmentation: false,
        smoothSegmentation: false,
        minDetectionConfidence: 0.65,
        minTrackingConfidence: 0.65
      });

      poseEngine.onResults(onPoseResults);
      return true;
    } catch (err) {
      console.error("Erro ao inicializar MediaPipe Pose:", err);
      return false;
    }
  }

  function onPoseResults(results) {
    if (!isRunning || bleSensor.isConnected) return;
    resizeCanvas();

    const width = canvasElement.width;
    const height = canvasElement.height;
    const sourceMode = sourceSelect.value;
    const useFilter = chkNoiseFilter.checked;

    canvasCtx.clearRect(0, 0, width, height);

    if ((sourceMode === 'webcam' || sourceMode === 'video') && results.image) {
      canvasCtx.save();
      if (sourceMode === 'webcam') {
        canvasCtx.translate(width, 0);
        canvasCtx.scale(-1, 1);
      }
      canvasCtx.drawImage(results.image, 0, 0, width, height);
      canvasCtx.restore();
    }

    if (results.poseLandmarks && results.poseLandmarks.length >= 33) {
      const processedData = analyzer.processFrame(results.poseLandmarks, useFilter);
      renderBiomechanicalOverlay(processedData.landmarksProcessed, processedData, sourceMode === 'webcam');
      updatePatientUI(processedData);
    } else if (sourceMode === 'webcam' || sourceMode === 'video') {
      hudPhaseText.textContent = "POSICIONE-SE EM FRENTE À CÂMERA";
      hudKneeAngle.textContent = "--°";
      jsonStreamOutput.textContent = analyzer.formatJSONProtocol(null, sourceMode === 'webcam' ? "Câmera BioPhysio IoT - Vista Frontal ao Vivo" : "Câmera BioPhysio IoT - Arquivo de Vídeo");
    }
  }

  // Elementos do DOM - Câmeras Físicas
  const cameraDeviceSelect = document.getElementById('camera-device-select');
  const btnScanCameras = document.getElementById('btn-scan-cameras');
  const btnScanCamerasError = document.getElementById('btn-scan-cameras-error');

  function stopMediaStream() {
    if (mediaStream) {
      mediaStream.getTracks().forEach(track => track.stop());
      mediaStream = null;
    }
    if (videoElement) {
      videoElement.pause();
      videoElement.srcObject = null;
      videoElement.removeAttribute('src');
    }
  }

  /**
   * DETECÇÃO E LISTAGEM DE CÂMERAS PRESENTES NO DISPOSITIVO
   */
  async function detectAvailableCameras() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      alert("Seu navegador não suporta detecção de dispositivos de mídia.");
      return [];
    }

    try {
      updateStatusText("Buscando Câmeras...", "yellow");
      
      // Solicita permissão temporária para revelar os nomes/labels das câmeras caso estejam vazias
      try {
        const tempStream = await navigator.mediaDevices.getUserMedia({ video: true });
        tempStream.getTracks().forEach(t => t.stop());
      } catch (e) {
        console.warn("Permissão de câmera não concedida previamente:", e);
      }

      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(device => device.kind === 'videoinput');

      if (cameraDeviceSelect) {
        cameraDeviceSelect.innerHTML = '';

        if (videoDevices.length === 0) {
          const opt = document.createElement('option');
          opt.value = "";
          opt.textContent = "❌ Nenhuma Câmera Encontrada";
          cameraDeviceSelect.appendChild(opt);
          cameraDeviceSelect.classList.remove('hidden');
          showCameraError("Nenhuma câmera física ou virtual foi localizada no seu computador.");
          updateStatusText("Nenhuma Câmera", "red");
        } else {
          videoDevices.forEach((device, index) => {
            const opt = document.createElement('option');
            opt.value = device.deviceId;
            opt.textContent = `📷 ${device.label || `Câmera ${index + 1}`}`;
            cameraDeviceSelect.appendChild(opt);
          });

          cameraDeviceSelect.classList.remove('hidden');
          updateStatusText(`${videoDevices.length} Câmera(s) Localizada(s)`, "green");
        }
      }

      return videoDevices;
    } catch (err) {
      console.error("Erro ao enumerar câmeras do dispositivo:", err);
      showCameraError(`Erro na busca de câmeras: ${err.message}`);
      return [];
    }
  }

  async function startWebcamStream(targetDeviceId = null) {
    stopMediaStream();
    hideCameraError();
    updateStatusText("Conectando Câmera...", "yellow");

    if (!initPoseEngine()) {
      showCameraError("Não foi possível carregar a biblioteca MediaPipe Pose.");
      updateStatusText("Erro no Motor AI", "red");
      return;
    }

    try {
      const selectedDeviceId = targetDeviceId || (cameraDeviceSelect ? cameraDeviceSelect.value : null);
      
      const videoConstraints = selectedDeviceId && selectedDeviceId !== ""
        ? { deviceId: { exact: selectedDeviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
        : { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } };

      const stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints,
        audio: false
      });

      mediaStream = stream;
      videoElement.srcObject = stream;
      await videoElement.play();

      // Atualiza lista de câmeras caso ainda não populada
      if (cameraDeviceSelect && cameraDeviceSelect.children.length <= 1) {
        detectAvailableCameras();
      }

      updateStatusText("Câmera Conectada (30 FPS)", "green");
      if (!isRunning) btnStart.click();
    } catch (err) {
      console.error("Erro ao iniciar webcam:", err);
      showCameraError(err.message || "Erro de acesso à câmera selecionada.");
      updateStatusText("Câmera Desconectada", "red");
    }
  }

  function handleVideoFile(file) {
    stopMediaStream();
    hideCameraError();
    if (!file) return;

    if (!initPoseEngine()) {
      showCameraError("Erro ao inicializar biblioteca de Visão Computacional.");
      return;
    }

    const url = URL.createObjectURL(file);
    videoElement.src = url;
    videoElement.loop = true;
    videoElement.play();
    updateStatusText(`Vídeo: ${file.name}`, "green");
    if (!isRunning) btnStart.click();
  }

  /**
   * GERADOR DE KEYPOINTS SINTÉTICOS (Modo Simulador Biomecânico de Alta Precisão)
   * Cinemática realista com movimento sincronizado de cabeça, ombros, tronco e quadril.
   */
  function generateSyntheticLandmarks() {
    simTime += 0.035;
    const exKey = exerciseSelect ? exerciseSelect.value : "squat";
    const lms = new Array(33).fill(0).map(() => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.99 }));

    if (exKey === "squat") {
      // Cinemática Realista de Agachamento Terapêutico
      const depth = (Math.sin(simTime) + 1) / 2; // 0 (em pé) a 1 (agachado a ~85-90°)
      const isValgusCycle = Math.floor(simTime / (Math.PI * 2)) % 3 === 1;

      // Ancoragem e Alturas Proporcionais Reais
      const headBaseY = 0.16;
      const shoulderBaseY = 0.28;
      const hipBaseY = 0.52;
      const kneeBaseY = 0.70;
      const ankleY = 0.86;
      const heelY = 0.88;

      // Deslocamento vertical sincronizado de toda a parte superior do corpo
      const verticalDrop = depth * 0.18;
      const headY = headBaseY + verticalDrop;
      const shoulderY = shoulderBaseY + verticalDrop;
      const hipY = hipBaseY + verticalDrop;

      // Flexão de Joelhos (Deslocamento anterior/lateral)
      const kneeY = kneeBaseY + depth * 0.06;
      const kneeXOffset = isValgusCycle && depth > 0.4 ? 0.03 : 0.12; // Se valgo, joelhos colapsam para dentro

      // Cabeça & Face (Landmarks 0 a 10)
      lms[0] = { x: 0.50, y: headY, z: -0.05, visibility: 0.99 };         // Nariz
      lms[2] = { x: 0.48, y: headY - 0.01, z: -0.05, visibility: 0.99 };  // Olho E
      lms[5] = { x: 0.52, y: headY - 0.01, z: -0.05, visibility: 0.99 };  // Olho D
      lms[7] = { x: 0.46, y: headY, z: 0, visibility: 0.99 };             // Orelha E
      lms[8] = { x: 0.54, y: headY, z: 0, visibility: 0.99 };             // Orelha D

      // Tronco e Ombros (Landmarks 11, 12, 23, 24)
      lms[11] = { x: 0.38, y: shoulderY, z: 0, visibility: 0.99 };        // Ombro E
      lms[12] = { x: 0.62, y: shoulderY, z: 0, visibility: 0.99 };        // Ombro D
      lms[23] = { x: 0.40, y: hipY, z: 0, visibility: 0.99 };             // Quadril E
      lms[24] = { x: 0.60, y: hipY, z: 0, visibility: 0.99 };             // Quadril D

      // Braços em Elevação Frontal de Equilíbrio
      lms[13] = { x: 0.36, y: shoulderY + 0.10, z: -0.1, visibility: 0.99 }; // Cotovelo E
      lms[14] = { x: 0.64, y: shoulderY + 0.10, z: -0.1, visibility: 0.99 }; // Cotovelo D
      lms[15] = { x: 0.35, y: shoulderY + 0.18, z: -0.2, visibility: 0.99 }; // Pulso E
      lms[16] = { x: 0.65, y: shoulderY + 0.18, z: -0.2, visibility: 0.99 }; // Pulso D

      // Membros Inferiores (Landmarks 25 a 30)
      lms[25] = { x: 0.50 - kneeXOffset, y: kneeY, z: -0.05, visibility: 0.99 }; // Joelho E
      lms[26] = { x: 0.50 + kneeXOffset, y: kneeY, z: -0.05, visibility: 0.99 }; // Joelho D
      lms[27] = { x: 0.38, y: ankleY, z: 0, visibility: 0.99 };                 // Tornozelo E
      lms[28] = { x: 0.62, y: ankleY, z: 0, visibility: 0.99 };                 // Tornozelo D
      lms[29] = { x: 0.38, y: heelY, z: 0.05, visibility: 0.99 };              // Calcanhar E
      lms[30] = { x: 0.62, y: heelY, z: 0.05, visibility: 0.99 };              // Calcanhar D
    } else if (exKey === "shoulder_abduction") {
      // Abdução de Ombro (Elevação Lateral)
      const factor = (Math.sin(simTime) + 1) / 2;
      const armAngle = factor * (Math.PI / 2); // 0 a 90°

      const shoulderY = 0.28;
      const hipY = 0.52;
      const kneeY = 0.70;
      const ankleY = 0.86;

      lms[0] = { x: 0.50, y: 0.16, z: 0, visibility: 0.99 };
      lms[11] = { x: 0.38, y: shoulderY, z: 0, visibility: 0.99 };
      lms[12] = { x: 0.62, y: shoulderY, z: 0, visibility: 0.99 };
      lms[23] = { x: 0.41, y: hipY, z: 0, visibility: 0.99 };
      lms[24] = { x: 0.59, y: hipY, z: 0, visibility: 0.99 };
      lms[25] = { x: 0.41, y: kneeY, z: 0, visibility: 0.99 };
      lms[26] = { x: 0.59, y: kneeY, z: 0, visibility: 0.99 };
      lms[27] = { x: 0.41, y: ankleY, z: 0, visibility: 0.99 };
      lms[28] = { x: 0.59, y: ankleY, z: 0, visibility: 0.99 };

      const armLen1 = 0.16;
      const armLen2 = 0.16;
      lms[13] = { x: 0.38 - Math.sin(armAngle) * armLen1, y: shoulderY + Math.cos(armAngle) * armLen1, z: 0, visibility: 0.99 };
      lms[14] = { x: 0.62 + Math.sin(armAngle) * armLen1, y: shoulderY + Math.cos(armAngle) * armLen1, z: 0, visibility: 0.99 };
      lms[15] = { x: 0.38 - Math.sin(armAngle) * (armLen1 + armLen2), y: shoulderY + Math.cos(armAngle) * (armLen1 + armLen2), z: 0, visibility: 0.99 };
      lms[16] = { x: 0.62 + Math.sin(armAngle) * (armLen1 + armLen2), y: shoulderY + Math.cos(armAngle) * (armLen1 + armLen2), z: 0, visibility: 0.99 };
    } else if (exKey === "biceps_curl") {
      // Rosca Direta de Bíceps
      const curlFactor = (Math.sin(simTime) + 1) / 2;
      const shoulderY = 0.28;
      const hipY = 0.52;
      const kneeY = 0.70;
      const ankleY = 0.86;

      lms[0] = { x: 0.50, y: 0.16, z: 0, visibility: 0.99 };
      lms[11] = { x: 0.38, y: shoulderY, z: 0, visibility: 0.99 };
      lms[12] = { x: 0.62, y: shoulderY, z: 0, visibility: 0.99 };
      lms[23] = { x: 0.41, y: hipY, z: 0, visibility: 0.99 };
      lms[24] = { x: 0.59, y: hipY, z: 0, visibility: 0.99 };
      lms[25] = { x: 0.41, y: kneeY, z: 0, visibility: 0.99 };
      lms[26] = { x: 0.59, y: kneeY, z: 0, visibility: 0.99 };
      lms[27] = { x: 0.41, y: ankleY, z: 0, visibility: 0.99 };
      lms[28] = { x: 0.59, y: ankleY, z: 0, visibility: 0.99 };

      lms[13] = { x: 0.37, y: shoulderY + 0.16, z: 0, visibility: 0.99 }; // Cotovelo fixo
      lms[14] = { x: 0.63, y: shoulderY + 0.16, z: 0, visibility: 0.99 };

      const wristY = (shoulderY + 0.32) - curlFactor * 0.24;
      const wristXOffset = curlFactor * 0.03;
      lms[15] = { x: 0.37 + wristXOffset, y: wristY, z: -curlFactor * 0.1, visibility: 0.99 };
      lms[16] = { x: 0.63 - wristXOffset, y: wristY, z: -curlFactor * 0.1, visibility: 0.99 };
    } else if (exKey === "triceps_extension") {
      // Extensão de Tríceps Coice
      const extFactor = (Math.sin(simTime) + 1) / 2;
      const shoulderY = 0.28;
      const hipY = 0.52;
      const kneeY = 0.70;
      const ankleY = 0.86;

      lms[0] = { x: 0.50, y: 0.16, z: 0, visibility: 0.99 };
      lms[11] = { x: 0.38, y: shoulderY, z: 0, visibility: 0.99 };
      lms[12] = { x: 0.62, y: shoulderY, z: 0, visibility: 0.99 };
      lms[23] = { x: 0.41, y: hipY, z: 0, visibility: 0.99 };
      lms[24] = { x: 0.59, y: hipY, z: 0, visibility: 0.99 };
      lms[25] = { x: 0.41, y: kneeY, z: 0, visibility: 0.99 };
      lms[26] = { x: 0.59, y: kneeY, z: 0, visibility: 0.99 };
      lms[27] = { x: 0.41, y: ankleY, z: 0, visibility: 0.99 };
      lms[28] = { x: 0.59, y: ankleY, z: 0, visibility: 0.99 };

      lms[13] = { x: 0.34, y: shoulderY + 0.10, z: 0, visibility: 0.99 };
      lms[14] = { x: 0.66, y: shoulderY + 0.10, z: 0, visibility: 0.99 };

      const wristX = 0.34 - extFactor * 0.18;
      const wristY = (shoulderY + 0.24) - extFactor * 0.14;
      lms[15] = { x: wristX, y: wristY, z: 0, visibility: 0.99 };
      lms[16] = { x: 1 - wristX, y: wristY, z: 0, visibility: 0.99 };
    }

    return lms;
  }

  /**
   * RENDERIZADOR VOLUMÉTRICO AVANÇADO DE MANEQUIM 3D E ESTÚDIO BIOMECÂNICO
   */
  function renderBiomechanicalOverlay(landmarks, data, isMirrored = false) {
    const width = canvasElement.width;
    const height = canvasElement.height;
    const isSimulated = sourceSelect.value === 'simulated';

    if (!landmarks || landmarks.length < 33) return;

    // 1. RENDERIZAR ESTÚDIO DE ANÁLISE 3D FUTURISTA (SE MODO SIMULADOR)
    if (isSimulated) {
      drawStudioGridEnvironment(canvasCtx, width, height);
    }

    const toPx = (lm) => {
      const xPx = isMirrored ? (1 - lm.x) * width : lm.x * width;
      return { x: xPx, y: lm.y * height };
    };

    const nose = lmsToPx(landmarks[0], toPx);
    const p11 = lmsToPx(landmarks[11], toPx); // Ombro E
    const p12 = lmsToPx(landmarks[12], toPx); // Ombro D
    const p13 = lmsToPx(landmarks[13], toPx); // Cotovelo E
    const p14 = lmsToPx(landmarks[14], toPx); // Cotovelo D
    const p15 = lmsToPx(landmarks[15], toPx); // Pulso E
    const p16 = lmsToPx(landmarks[16], toPx); // Pulso D
    const p23 = lmsToPx(landmarks[23], toPx); // Quadril E
    const p24 = lmsToPx(landmarks[24], toPx); // Quadril D
    const p25 = lmsToPx(landmarks[25], toPx); // Joelho E
    const p26 = lmsToPx(landmarks[26], toPx); // Joelho D
    const p27 = lmsToPx(landmarks[27], toPx); // Tornozelo E
    const p28 = lmsToPx(landmarks[28], toPx); // Tornozelo D

    const isAlert = data?.qualidadeExecucao?.status !== "EXCELENTE";
    const statusColor = isAlert ? "#ef4444" : "#10b981";
    const accentColor = isAlert ? "rgba(239, 68, 68, 0.35)" : "rgba(16, 185, 129, 0.25)";

    // 2. RENDERIZAR MALHA VOLUMÉTRICA DO TRONCO (PEITORAL / ABDÔMEN)
    if (p11 && p12 && p23 && p24) {
      canvasCtx.save();
      canvasCtx.beginPath();
      canvasCtx.moveTo(p11.x, p11.y);
      canvasCtx.lineTo(p12.x, p12.y);
      canvasCtx.lineTo(p24.x, p24.y);
      canvasCtx.lineTo(p23.x, p23.y);
      canvasCtx.closePath();

      const torsoGrad = canvasCtx.createLinearGradient(0, p11.y, 0, p23.y);
      torsoGrad.addColorStop(0, accentColor);
      torsoGrad.addColorStop(1, "rgba(6, 182, 212, 0.05)");

      canvasCtx.fillStyle = torsoGrad;
      canvasCtx.fill();
      canvasCtx.lineWidth = 1.5;
      canvasCtx.strokeStyle = statusColor;
      canvasCtx.stroke();
      canvasCtx.restore();
    }

    // 3. RENDERIZAR CABEÇA E MANEQUIM FACIAL
    if (nose && p11 && p12) {
      const shoulderCenterX = (p11.x + p12.x) / 2;
      const shoulderCenterY = (p11.y + p12.y) / 2;
      const headRadius = Math.max(18, Math.abs(p12.x - p11.x) * 0.25);

      canvasCtx.save();
      // Cabeça
      canvasCtx.beginPath();
      canvasCtx.arc(shoulderCenterX, nose.y - 5, headRadius, 0, Math.PI * 2);
      canvasCtx.fillStyle = "rgba(15, 23, 42, 0.8)";
      canvasCtx.fill();
      canvasCtx.lineWidth = 2;
      canvasCtx.strokeStyle = statusColor;
      canvasCtx.stroke();

      // Viseira Tecnológica Futurista
      drawRoundRect(canvasCtx, shoulderCenterX - headRadius * 0.6, nose.y - 12, headRadius * 1.2, 8, 4);
      canvasCtx.fillStyle = isAlert ? "#fca5a5" : "#38bdf8";
      canvasCtx.shadowColor = isAlert ? "#ef4444" : "#0284c7";
      canvasCtx.shadowBlur = 8;
      canvasCtx.fill();
      canvasCtx.restore();
    }

    // 4. RENDERIZAR SEGMENTOS MUSCULARES VOLUMÉTRICOS (CÁPSULAS ANATÔMICAS)
    const capsules = [
      [p11, p13, 14], [p13, p15, 11], // Braço E, Antebraço E
      [p12, p14, 14], [p14, p16, 11], // Braço D, Antebraço D
      [p23, p25, 20], [p25, p27, 16], // Coxa E (Quads), Perna E
      [p24, p26, 20], [p26, p28, 16]  // Coxa D (Quads), Perna D
    ];

    capsules.forEach(([from, to, radius]) => {
      if (from && to) {
        drawLimbCapsule(canvasCtx, from, to, radius, statusColor, isAlert);
      }
    });

    // 5. RENDERIZAR ESFERAS ARTICULARES E ANÉIS
    const jointNodes = [p11, p12, p13, p14, p15, p16, p23, p24, p25, p26, p27, p28];
    jointNodes.forEach(pt => {
      if (!pt) return;
      canvasCtx.save();
      // Brilho Neon Externo
      canvasCtx.beginPath();
      canvasCtx.arc(pt.x, pt.y, 8, 0, 2 * Math.PI);
      canvasCtx.fillStyle = "rgba(255, 255, 255, 0.9)";
      canvasCtx.shadowColor = statusColor;
      canvasCtx.shadowBlur = 12;
      canvasCtx.fill();

      // Anel metálico
      canvasCtx.lineWidth = 2;
      canvasCtx.strokeStyle = statusColor;
      canvasCtx.stroke();
      canvasCtx.restore();
    });

    // 6. RENDERIZAR MEDIDOR DE ÂNGULO E VETORES
    if (data && data.angulosAtuais) {
      const exKey = data.exerciseKey || "squat";
      if (exKey === "squat" && p25) {
        drawAngleBadge(canvasCtx, p25, `${Math.round(data.angulosAtuais.principalDeg)}°`, statusColor, "Flexão Joelho");
      } else if (exKey === "shoulder_abduction" && p11) {
        drawAngleBadge(canvasCtx, p11, `${Math.round(data.angulosAtuais.principalDeg)}°`, statusColor, "Abdução Ombro");
      } else if ((exKey === "biceps_curl" || exKey === "triceps_extension") && p13) {
        drawAngleBadge(canvasCtx, p13, `${Math.round(data.angulosAtuais.principalDeg)}°`, statusColor, "Flexão Cotovelo");
      }
    }

    // 7. ALERTA VISUAL DE VETOR DE VALGO (SE DETECTADO)
    if (data?.falhasDetectadas?.valgoDinamico && p25 && p26) {
      canvasCtx.save();
      canvasCtx.beginPath();
      canvasCtx.setLineDash([6, 6]);
      canvasCtx.moveTo(p25.x, p25.y);
      canvasCtx.lineTo(p26.x, p26.y);
      canvasCtx.strokeStyle = "#ef4444";
      canvasCtx.lineWidth = 3;
      canvasCtx.stroke();

      // Seta de força medial
      const midX = (p25.x + p26.x) / 2;
      const midY = (p25.y + p26.y) / 2;
      canvasCtx.font = "bold 12px Inter, sans-serif";
      canvasCtx.fillStyle = "#ef4444";
      canvasCtx.fillText("⚠️ COLAPSO MEDIAL (VALGO)", midX - 80, midY - 10);
      canvasCtx.restore();
    }
  }

  function lmsToPx(lm, toPxFn) {
    return lm ? toPxFn(lm) : null;
  }

  /**
   * RENDERIZADOR DE ESTÚDIO BIOMECÂNICO FUTURISTA (BACKGROUND GRID)
   */
  function drawStudioGridEnvironment(ctx, w, h) {
    ctx.save();
    // Fundo Degradê Estúdio Neon Dark
    const bgGrad = ctx.createRadialGradient(w / 2, h / 2, 50, w / 2, h / 2, w * 0.75);
    bgGrad.addColorStop(0, "#0f172a");
    bgGrad.addColorStop(1, "#020617");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    // Grade de Perspectiva 3D do Solo
    const horizonY = h * 0.58;
    ctx.strokeStyle = "rgba(51, 65, 85, 0.35)";
    ctx.lineWidth = 1;

    // Linhas Verticais de Perspectiva
    for (let x = -w; x <= w * 2; x += w / 8) {
      ctx.beginPath();
      ctx.moveTo(w / 2, horizonY);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    // Linhas Horizontais do Solo
    for (let y = horizonY; y <= h; y += (h - horizonY) / 6) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Plataforma Circular sob os pés do paciente
    ctx.beginPath();
    ctx.ellipse(w / 2, h * 0.88, w * 0.28, h * 0.06, 0, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(6, 182, 212, 0.4)";
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Régua de Calibração Lateral de Altura
    ctx.strokeStyle = "rgba(148, 163, 184, 0.25)";
    ctx.fillStyle = "rgba(148, 163, 184, 0.6)";
    ctx.font = "10px Inter, monospace";
    ctx.beginPath();
    ctx.moveTo(25, 40);
    ctx.lineTo(25, h - 40);
    ctx.stroke();

    for (let y = 60; y < h - 40; y += 40) {
      ctx.beginPath();
      ctx.moveTo(20, y);
      ctx.lineTo(30, y);
      ctx.stroke();
      const heightMeters = ((h - y) / h * 2.2).toFixed(1);
      ctx.fillText(`${heightMeters}m`, 34, y + 3);
    }

    ctx.restore();
  }

  /**
   * RENDERIZADOR DE CÁPSULAS ANATÔMICAS VOLUMÉTRICAS DE MEMBROS
   */
  function drawLimbCapsule(ctx, pA, pB, radius, color, isAlert) {
    const dx = pB.x - pA.x;
    const dy = pB.y - pA.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) return;

    const angle = Math.atan2(dy, dx);

    ctx.save();
    ctx.translate(pA.x, pA.y);
    ctx.rotate(angle);

    ctx.beginPath();
    ctx.arc(0, 0, radius, Math.PI / 2, (3 * Math.PI) / 2);
    ctx.lineTo(len, -radius);
    ctx.arc(len, 0, radius, (3 * Math.PI) / 2, Math.PI / 2);
    ctx.closePath();

    ctx.fillStyle = isAlert ? "rgba(239, 68, 68, 0.15)" : "rgba(6, 182, 212, 0.12)";
    ctx.fill();

    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 6;
    ctx.stroke();

    ctx.restore();
  }

  /**
   * HELPER SEGURO DE RETÂNGULO COM CANTOS ARREDONDADOS
   */
  function drawRoundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(x, y, width, height, radius);
    } else {
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + width - radius, y);
      ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
      ctx.lineTo(x + width, y + height - radius);
      ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
      ctx.lineTo(x + radius, y + height);
      ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
    }
  }

  /**
   * CRACHÁ DE ÂNGULO COM TIPOGRAFIA MODERNA E INDICADOR ARTICULAR
   */
  function drawAngleBadge(ctx, vertex, labelText, color, jointTitle) {
    ctx.save();
    const boxW = 86;
    const boxH = 34;
    const x = vertex.x - boxW / 2;
    const y = vertex.y + 25;

    drawRoundRect(ctx, x, y, boxW, boxH, 8);
    ctx.fillStyle = "rgba(15, 23, 42, 0.88)";
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = color;
    ctx.stroke();

    ctx.font = "bold 13px Outfit, sans-serif";
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.fillText(labelText, vertex.x, y + 16);

    ctx.font = "9px Inter, sans-serif";
    ctx.fillStyle = "#94a3b8";
    ctx.fillText(jointTitle, vertex.x, y + 28);
    ctx.restore();
  }

  /**
   * ATUALIZAÇÃO DA INTERFACE DO PACIENTE
   */
  function updatePatientUI(data) {
    if (!data || !data.angulosAtuais) return;
    const isSensorEvaluation = Boolean(data.sensorTelemetry);
    // Do not let a camera frame already in progress overwrite live BLE telemetry.
    if (bleSensor && bleSensor.isConnected && !isSensorEvaluation) return;

    hudPhaseText.textContent = data.faseMovimento ? data.faseMovimento.toUpperCase() : "NEUTRO";
    hudKneeAngle.textContent = `${data.angulosAtuais.principalDeg.toFixed(0)}°`;
    if (hudAngleSub) hudAngleSub.textContent = data.targetJointName || "Ângulo Alvo";

    // Regulador de Distância
    if (data.distanceEval && canvasDistanceToast) {
      canvasDistanceMsg.textContent = data.distanceEval.message;
      canvasDistanceToast.className = `canvas-distance-toast ${data.distanceEval.status.toLowerCase().replace('_', '-')}`;
    }

    const status = data.qualidadeExecucao.status;
    const msg = data.qualidadeExecucao.mensagemFeedback;

    const needsCorrection = status !== 'EXCELENTE';
    patientFeedbackCard.className = `patient-feedback-card status-${status === 'EXCELENTE' ? 'good' : (status === 'ATENÇÃO' ? 'warning' : 'danger')}`;
    feedbackTag.textContent = needsCorrection ? 'CORREÇÃO NECESSÁRIA' : (isSensorEvaluation ? 'AVALIAÇÃO DE AMPLITUDE' : 'EXCELENTE POSTURA');
    feedbackMainMsg.textContent = isSensorEvaluation && needsCorrection
      ? `Ajuste o movimento. Ângulo atual: ${data.angulosAtuais.principalDeg.toFixed(1)}°. Alvo: ${data.targetRange}.`
      : msg;
    if (feedbackIconContainer) {
      feedbackIconContainer.innerHTML = `<i data-lucide="${needsCorrection ? 'alert-triangle' : 'check-circle-2'}"></i>`;
      if (window.lucide) lucide.createIcons({ root: feedbackIconContainer });
    }

    if (needsCorrection && !isSensorEvaluation) {
      speakFeedback(msg);
      canvasWarningToast.classList.remove('hidden');
      canvasWarningMsg.textContent = msg;
    } else if (needsCorrection && isSensorEvaluation) {
      canvasWarningToast.classList.add('hidden');
      speakFeedback(feedbackMainMsg.textContent);
    } else {
      canvasWarningToast.classList.add('hidden');
    }

    valKneeAngle.textContent = `${data.angulosAtuais.principalDeg.toFixed(1)}°`;
    if (targetKneeAngle && data.targetRange) {
      targetKneeAngle.textContent = `Alvo: ${data.targetRange}`;
    }
    const mainPct = Math.min(100, Math.max(0, (data.angulosAtuais.principalDeg / 180) * 100));
    barKneeFlexion.style.width = `${mainPct}%`;

    valTrunkAngle.textContent = `${data.angulosAtuais.secundarioDeg.toFixed(1)}°`;
    const secPct = Math.min(100, (data.angulosAtuais.secundarioDeg / 45) * 100);
    barTrunkAngle.style.width = `${secPct}%`;

    repTotal.textContent = data.repeticoes.completas;
    repCorrect.textContent = data.repeticoes.corretas;
    repFaults.textContent = data.repeticoes.comCompensacao;

    const activeCam = isSensorEvaluation
      ? "Sensor Bluetooth BLE HM-06"
      : sourceSelect.value === 'webcam' ? "Câmera BioPhysio IoT - Vista Frontal ao Vivo" : "Câmera BioPhysio IoT - Simulador Sintético";
    currentJSONProtocol = analyzer.formatJSONProtocol(data, activeCam);
    jsonStreamOutput.textContent = currentJSONProtocol;

    sessionLogs.push(JSON.parse(currentJSONProtocol));
    if (sessionLogs.length > 500) sessionLogs.shift();
  }

  const bleSensor = new window.LeanstarBLEManager(
    (reading) => {
      sessionUsedBleSensor = true;
      const liveReadingLabel = Number.isFinite(reading.rawPercent)
        ? `${reading.rawPercent.toFixed(0)}% → ${reading.angleDeg.toFixed(1)}°`
        : `${reading.angleDeg.toFixed(1)}°`;
      updateStatusText(`Sensor BLE recebendo: ${liveReadingLabel}`, "green");
      const data = analyzer.processSensorAngle(reading.angleDeg);
      data.sensorTelemetry = reading;
      updatePatientUI(data);
    },
    (connected, deviceName) => {
      if (connected) {
        sessionUsedBleSensor = true;
        patientFeedbackCard.className = "patient-feedback-card status-warning";
        feedbackTag.textContent = "AGUARDANDO LEITURA DO SENSOR";
        feedbackMainMsg.textContent = "Sensor conectado. Aguardando o primeiro ângulo do Arduino.";
        valKneeAngle.textContent = "--°";
      }
      if (btnConnectSensor) {
        btnConnectSensor.classList.toggle('btn-outline', !connected);
        btnConnectSensor.classList.toggle('btn-primary', connected);
        btnConnectSensor.innerHTML = '<i data-lucide="bluetooth"></i><span class="btn-text"></span>';
        btnConnectSensor.querySelector('.btn-text').textContent = connected
          ? `Desconectar ${deviceName}`
          : "Conectar sensor BLE";
        if (window.lucide) lucide.createIcons();
      }
      updateStatusText(
        connected ? `Sensor BLE conectado; aguardando dados: ${deviceName}` : "Sensor BLE desconectado",
        connected ? "green" : "amber"
      );
    }
  );

  /**
   * LOOP PRINCIPAL DE PROCESSAMENTO
   */
  async function mainLoop() {
    if (!isRunning) return;
    if (bleSensor.isConnected) {
      animationFrameId = requestAnimationFrame(mainLoop);
      return;
    }

    resizeCanvas();
    const useFilter = chkNoiseFilter.checked;
    const sourceMode = sourceSelect.value;

    if (sourceMode === 'simulated') {
      hideCameraError();
      const rawLandmarks = generateSyntheticLandmarks();
      const processedData = analyzer.processFrame(rawLandmarks, useFilter);
      renderBiomechanicalOverlay(processedData.landmarksProcessed, processedData, false);
      updatePatientUI(processedData);
    } else if (sourceMode === 'webcam' || sourceMode === 'video') {
      if (videoElement && videoElement.readyState >= 2 && !videoElement.paused && !videoElement.ended) {
        if (poseEngine && !isSendingFrame) {
          isSendingFrame = true;
          try {
            await poseEngine.send({ image: videoElement });
          } catch (err) {
            console.error("Erro no envio do frame para o MediaPipe:", err);
          } finally {
            isSendingFrame = false;
          }
        }
      }
    }

    animationFrameId = requestAnimationFrame(mainLoop);
  }

  // EVENT LISTENERS DE INTERFAZ E REQUISITOS FASE 2

  // 1. Troca de Exercício Modular
  if (exerciseSelect) {
    exerciseSelect.addEventListener('change', (e) => {
      const selectedId = e.target.value;
      analyzer.setExercise(selectedId);
      btnReset.click();
    });
  }

  // 2. Conexão do sensor por Bluetooth BLE
  if (btnConnectSensor) {
    btnConnectSensor.addEventListener('click', async () => {
      if (bleSensor.isConnected) {
        await bleSensor.disconnect();
        return;
      }

      updateStatusText("Abrindo seletor de dispositivos Bluetooth...", "amber");
      try {
        await bleSensor.connect();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        updateStatusText(
          err && err.name === "NotFoundError"
            ? "Seletor fechado ou nenhum sensor selecionado. Se não abriu, verifique o suporte/adaptador BLE."
            : "Não foi possível abrir o seletor Bluetooth.",
          "red"
        );
        if (!err || err.name !== "NotFoundError") {
          alert(`Não foi possível conectar ao sensor Bluetooth: ${message}`);
        }
      }
    });
  }

  // 3. Trava de Rastreamento de Paciente ao Clicar no Canvas
  canvasElement.addEventListener('click', (e) => {
    const rect = canvasElement.getBoundingClientRect();
    const clickX = (e.clientX - rect.left) / rect.width;
    const clickY = (e.clientY - rect.top) / rect.height;

    analyzer.subjectTracker.setTarget(clickX, clickY);
    if (canvasLockBadge) canvasLockBadge.classList.remove('hidden');
  });

  if (btnUnlockSubject) {
    btnUnlockSubject.addEventListener('click', (e) => {
      e.stopPropagation();
      analyzer.subjectTracker.clearTarget();
      if (canvasLockBadge) canvasLockBadge.classList.add('hidden');
    });
  }

  // 4. Detecção e Seleção de Câmeras Físicas
  if (btnScanCameras) {
    btnScanCameras.addEventListener('click', async () => {
      sourceSelect.value = 'webcam';
      const videoDevices = await detectAvailableCameras();
      if (videoDevices.length > 0) {
        await startWebcamStream(videoDevices[0].deviceId);
      }
    });
  }

  if (btnScanCamerasError) {
    btnScanCamerasError.addEventListener('click', async () => {
      sourceSelect.value = 'webcam';
      const videoDevices = await detectAvailableCameras();
      if (videoDevices.length > 0) {
        await startWebcamStream(videoDevices[0].deviceId);
      }
    });
  }

  if (cameraDeviceSelect) {
    cameraDeviceSelect.addEventListener('change', async (e) => {
      if (e.target.value) {
        sourceSelect.value = 'webcam';
        await startWebcamStream(e.target.value);
      }
    });
  }

  sourceSelect.addEventListener('change', async (e) => {
    const val = e.target.value;
    if (val === 'simulated') {
      stopMediaStream();
      hideCameraError();
      if (cameraDeviceSelect) cameraDeviceSelect.classList.add('hidden');
      updateStatusText("Motor Conectado (30 FPS)", "green");
    } else if (val === 'webcam') {
      await detectAvailableCameras();
      await startWebcamStream();
    } else if (val === 'video') {
      stopMediaStream();
      if (cameraDeviceSelect) cameraDeviceSelect.classList.add('hidden');
      videoFileInput.click();
    }
  });

  videoFileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleVideoFile(e.target.files[0]);
    }
  });

  if (btnRetryCamera) {
    btnRetryCamera.addEventListener('click', async () => {
      if (sourceSelect.value === 'webcam') {
        await detectAvailableCameras();
        await startWebcamStream();
      }
    });
  }

  btnStart.addEventListener('click', async () => {
    isRunning = true;
    btnStart.disabled = true;
    btnPause.disabled = false;

    if (sourceSelect.value === 'webcam' && !mediaStream) {
      await startWebcamStream();
    } else if (sourceSelect.value === 'video' && videoElement.paused) {
      videoElement.play();
    }

    mainLoop();
  });

  btnPause.addEventListener('click', () => {
    isRunning = false;
    btnStart.disabled = false;
    btnPause.disabled = true;
    if (videoElement && !videoElement.paused) {
      videoElement.pause();
    }
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
  });

  btnReset.addEventListener('click', () => {
    analyzer.resetSession();
    sessionLogs = [];
    sessionUsedBleSensor = bleSensor.isConnected;
    repTotal.textContent = "0";
    repCorrect.textContent = "0";
    repFaults.textContent = "0";
    jsonStreamOutput.textContent = '{\n  "status": "Sessão reiniciada."\n}';
  });

  btnToggleVoice.addEventListener('click', () => {
    voiceEnabled = !voiceEnabled;
    btnToggleVoice.classList.toggle('active', voiceEnabled);
    if (!voiceEnabled && synth) synth.cancel();
  });

  btnCopyJson.addEventListener('click', () => {
    if (currentJSONProtocol) {
      navigator.clipboard.writeText(currentJSONProtocol);
      btnCopyJson.innerHTML = `<i data-lucide="check"></i> Copiado!`;
      setTimeout(() => {
        btnCopyJson.innerHTML = `<i data-lucide="copy"></i> Copiar`;
        if (window.lucide) lucide.createIcons();
      }, 2000);
    }
  });

  btnDownloadSession.addEventListener('click', () => {
    if (sessionLogs.length === 0) return;
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(sessionLogs, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `biophysio_session_${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  });

    // =========================================================================
  // SISTEMA DE NAVEGAÇÃO & MENU DE INÍCIO HOSPITALAR (ROUTER & TRIAGEM)
  // =========================================================================
  const viewHome = document.getElementById('view-home');
  const viewWorkout = document.getElementById('view-workout');
  const btnNavHome = document.getElementById('btn-nav-home');
  const btnNavSession = document.getElementById('btn-nav-session');
  const btnBackHome = document.getElementById('btn-back-home');
  const brandLink = document.getElementById('brand-link');
  const navSessionBadge = document.getElementById('nav-session-badge');
  const startScreen = document.getElementById('start-screen');
  const appContainer = document.querySelector('.app-container:not(.start-screen)');
  const btnEnterApp = document.getElementById('btn-enter-app');

  if (btnEnterApp && startScreen && appContainer) {
    btnEnterApp.addEventListener('click', () => {
      startScreen.hidden = true;
      appContainer.hidden = false;
      if (window.lucide) lucide.createIcons();
    });
  }

  // Triagem e Paciente
  const inputPatientName = document.getElementById('input-patient-name');
  const inputTherapistName = document.getElementById('input-therapist-name');
  const homeSourceSelect = document.getElementById('home-source-select');
  const lblActivePatient = document.getElementById('lbl-active-patient');
  const lblActiveExercise = document.getElementById('lbl-active-exercise');
  const btnQuickStartCamera = document.getElementById('btn-quick-start-camera');
  const btnQuickStartSim = document.getElementById('btn-quick-start-sim');
  const homeLiveDatetime = document.getElementById('home-live-datetime');
  const btnHomeConnectBle = document.getElementById('btn-home-connect-ble');

  // Modal de Laudo Clínico
  const modalClinicalReport = document.getElementById('modal-clinical-report');
  const btnOpenReport = document.getElementById('btn-open-report');
  const btnQuickReport = document.getElementById('btn-quick-report');
  const btnCloseReport = document.getElementById('btn-close-report');
  const btnPrintReport = document.getElementById('btn-print-report');

  const repReportId = document.getElementById('rep-report-id');
  const repPatientName = document.getElementById('rep-patient-name');
  const repTherapistName = document.getElementById('rep-therapist-name');
  const repProtocolName = document.getElementById('rep-protocol-name');
  const repTimestamp = document.getElementById('rep-timestamp');
  const repTTotal = document.getElementById('rep-t-total');
  const repTCorrect = document.getElementById('rep-t-correct');
  const repTFaults = document.getElementById('rep-t-faults');
  const repTFaultsLabel = document.getElementById('rep-t-faults-label');
  const repTFaultsTarget = document.getElementById('rep-t-faults-target');
  const repTFaultsStatus = document.getElementById('rep-t-faults-status');
  const repTScore = document.getElementById('rep-t-score');
  const repTScoreLabel = document.getElementById('rep-t-score-label');
  const repTScoreTarget = document.getElementById('rep-t-score-target');
  const repTScoreStatus = document.getElementById('rep-t-score-status');
  const repClinicalText = document.getElementById('rep-clinical-text');
  const repSigTherapist = document.getElementById('rep-sig-therapist');

  const exerciseNamesMap = {
    'squat': 'Agachamento Terapêutico (Joelho & LCA)',
    'shoulder_abduction': 'Abdução de Ombro (Manguito Rotador)',
    'biceps_curl': 'Rosca Direta de Bíceps',
    'triceps_extension': 'Extensão de Tríceps (Coice)'
  };

  // Atualizar Relógio em Tempo Real
  function updateLiveClock() {
    const now = new Date();
    const formatted = now.toLocaleDateString('pt-BR') + ' ' + now.toLocaleTimeString('pt-BR');
    if (homeLiveDatetime) homeLiveDatetime.textContent = formatted;
  }
  setInterval(updateLiveClock, 1000);
  updateLiveClock();

  // Função de Troca de Telas
  function navigateToView(viewName) {
    if (viewName === 'home') {
      if (viewHome) {
        viewHome.classList.remove('hidden');
        viewHome.classList.add('active');
      }
      if (viewWorkout) {
        viewWorkout.classList.add('hidden');
        viewWorkout.classList.remove('active');
      }
      if (btnNavHome) btnNavHome.classList.add('active');
      if (btnNavSession) btnNavSession.classList.remove('active');
    } else if (viewName === 'workout') {
      if (viewHome) {
        viewHome.classList.add('hidden');
        viewHome.classList.remove('active');
      }
      if (viewWorkout) {
        viewWorkout.classList.remove('hidden');
        viewWorkout.classList.add('active');
      }
      if (btnNavHome) btnNavHome.classList.remove('active');
      if (btnNavSession) btnNavSession.classList.add('active');

      // Sincronizar dados do paciente na tela do monitor
      const pName = (inputPatientName && inputPatientName.value.trim()) || 'Paciente #PAC-2026-084';
      if (lblActivePatient) lblActivePatient.textContent = pName;

      const currentExKey = exerciseSelect ? exerciseSelect.value : 'squat';
      if (lblActiveExercise) lblActiveExercise.textContent = exerciseNamesMap[currentExKey] || currentExKey;

      if (navSessionBadge) {
        navSessionBadge.textContent = 'Ativo';
        navSessionBadge.classList.add('active');
      }

      // Redimensionar canvas de vídeo
      setTimeout(() => {
        resizeCanvas();
      }, 60);
    }

    if (window.lucide) {
      lucide.createIcons();
    }
  }

  // Eventos de Navegação
  if (btnNavHome) btnNavHome.addEventListener('click', () => navigateToView('home'));
  if (brandLink) brandLink.addEventListener('click', () => navigateToView('home'));
  if (btnBackHome) btnBackHome.addEventListener('click', () => navigateToView('home'));
  if (btnNavSession) btnNavSession.addEventListener('click', () => navigateToView('workout'));

  // Sincronizar alteração no seletor de exercícios com os rótulos do cabeçalho
  if (exerciseSelect) {
    exerciseSelect.addEventListener('change', (e) => {
      const selectedId = e.target.value;
      if (lblActiveExercise) lblActiveExercise.textContent = exerciseNamesMap[selectedId] || selectedId;
    });
  }

  // Cards de Seleção de Protocolo no Menu Inicial
  const protocolCards = document.querySelectorAll('.protocol-card');
  protocolCards.forEach(card => {
    card.addEventListener('click', () => {
      const exKey = card.getAttribute('data-exercise');
      if (exKey && exerciseSelect) {
        exerciseSelect.value = exKey;
        analyzer.setExercise(exKey);
        btnReset.click();
      }

      if (homeSourceSelect && sourceSelect) {
        sourceSelect.value = homeSourceSelect.value;
        sourceSelect.dispatchEvent(new Event('change'));
      }

      navigateToView('workout');

      if (!isRunning) {
        btnStart.click();
      }
    });
  });

  // Botões de Ação Rápida no Menu Inicial
  if (btnQuickStartCamera) {
    btnQuickStartCamera.addEventListener('click', () => {
      if (sourceSelect) {
        sourceSelect.value = 'webcam';
        sourceSelect.dispatchEvent(new Event('change'));
      }
      navigateToView('workout');
      if (!isRunning) {
        btnStart.click();
      }
    });
  }

  if (btnQuickStartSim) {
    btnQuickStartSim.addEventListener('click', () => {
      if (sourceSelect) {
        sourceSelect.value = 'simulated';
        sourceSelect.dispatchEvent(new Event('change'));
      }
      navigateToView('workout');
      if (!isRunning) {
        btnStart.click();
      }
    });
  }

  // Conexão IoT rápida do Menu Inicial
  if (btnHomeConnectBle && btnConnectSensor) {
    btnHomeConnectBle.addEventListener('click', (e) => {
      e.stopPropagation();
      btnConnectSensor.click();
    });
  }

  // =========================================================================
  // MODAL DE LAUDO CLÍNICO (EMISSÃO E IMPRESSÃO)
  // =========================================================================
  function populateAndOpenReport() {
    const pName = (inputPatientName && inputPatientName.value.trim()) || 'Paciente #PAC-2026-084';
    const tName = (inputTherapistName && inputTherapistName.value.trim()) || 'Dra. Fisioterapeuta Clínica (CREFITO-3)';
    const exKey = (exerciseSelect && exerciseSelect.value) || 'squat';
    const exName = exerciseNamesMap[exKey] || 'Agachamento Terapêutico';

    const totalReps = parseInt(repTotal.textContent, 10) || 0;
    const correctReps = parseInt(repCorrect.textContent, 10) || 0;
    const faultReps = parseInt(repFaults.textContent, 10) || 0;

    let scorePercent = 100;
    if (totalReps > 0) {
      scorePercent = Math.round((correctReps / totalReps) * 100);
    }

    const now = new Date();
    const dateFormatted = now.toLocaleDateString('pt-BR') + ' às ' + now.toLocaleTimeString('pt-BR');

    if (repReportId) repReportId.textContent = '#BP-' + now.getFullYear() + '-' + Math.floor(1000 + Math.random() * 9000);
    if (repPatientName) repPatientName.textContent = pName;
    if (repTherapistName) repTherapistName.textContent = tName;
    if (repSigTherapist) repSigTherapist.textContent = tName;
    if (repProtocolName) repProtocolName.textContent = exName;
    if (repTimestamp) repTimestamp.textContent = dateFormatted;

    if (repTTotal) repTTotal.textContent = totalReps + ' repetições';
    if (repTCorrect) repTCorrect.textContent = correctReps + ' repetições';
    if (sessionUsedBleSensor) {
      if (repTFaultsLabel) repTFaultsLabel.textContent = 'Postura e compensações';
      if (repTFaults) repTFaults.textContent = 'Não avaliadas';
      if (repTFaultsTarget) repTFaultsTarget.textContent = 'Não mensuradas pelo HM-06';
      if (repTFaultsStatus) repTFaultsStatus.textContent = 'Não avaliado';
      if (repTScoreLabel) repTScoreLabel.textContent = 'Eficácia biomecânica';
      if (repTScore) repTScore.textContent = 'N/A';
      if (repTScoreTarget) repTScoreTarget.textContent = 'Não avaliada pelo sensor';
      if (repTScoreStatus) repTScoreStatus.textContent = 'Apenas amplitude angular';
    } else {
      if (repTFaultsLabel) repTFaultsLabel.textContent = 'Repetições com Desvio / Compensação';
      if (repTFaults) repTFaults.textContent = faultReps + ' repetições';
      if (repTFaultsTarget) repTFaultsTarget.textContent = '< 30% das repetições';
      if (repTFaultsStatus) repTFaultsStatus.innerHTML = '<span class="r-status-ok">Controlado</span>';
      if (repTScoreLabel) repTScoreLabel.textContent = 'Taxa de Eficácia Biomecânica';
      if (repTScore) repTScore.textContent = scorePercent + '%';
      if (repTScoreTarget) repTScoreTarget.textContent = 'Meta ≥ 80%';

      if (repTScoreStatus) {
        if (scorePercent >= 80) {
          repTScoreStatus.innerHTML = '<span class="r-status-ok" style="background: #ecfdf5; color: #059669;">Excelente (' + scorePercent + '%)</span>';
        } else if (scorePercent >= 60) {
          repTScoreStatus.innerHTML = '<span class="r-status-ok" style="background: #fffbeb; color: #d97706;">Regular (' + scorePercent + '%)</span>';
        } else {
          repTScoreStatus.innerHTML = '<span class="r-status-ok" style="background: #fef2f2; color: #dc2626;">Atenção Requerida (' + scorePercent + '%)</span>';
        }
      }
    }

    if (repClinicalText) {
      if (sessionUsedBleSensor) {
        repClinicalText.textContent = totalReps === 0
          ? 'Sessão monitorada pelo sensor Bluetooth HM-06. A avaliação fica limitada à amplitude angular e à contagem de ciclos; postura, alinhamento e compensações precisam ser avaliados separadamente.'
          : 'As repetições foram contabilizadas ao completar o ciclo angular do sensor HM-06. Este sensor não mede alinhamento, postura ou compensações; esses aspectos não foram avaliados neste resultado.';
      } else if (totalReps === 0) {
        repClinicalText.textContent = 'A sessão de atendimento foi inicializada. Aguardando a execução completa de repetições pelo paciente para consolidar a análise biomecânica e estabilidade articular.';
      } else if (scorePercent >= 80) {
        repClinicalText.textContent = 'O paciente demonstrou excelente controle motor e alinhamento biomecânico ao longo do protocolo ' + exName + '. Os parâmetros de amplitude angular e fixação postural mantiveram-se dentro da faixa terapêutica recomendada pela literatura.';
      } else {
        repClinicalText.textContent = 'Durante a execução de ' + exName + ', foram observadas compensações pontuais (ex: desvios na trajetória articular ou compensação lombar). Recomenda-se ajuste de cadência e trabalho de fortalecimento sinergista nas próximas sessões.';
      }
    }

    if (modalClinicalReport) {
      modalClinicalReport.classList.remove('hidden');
      if (window.lucide) lucide.createIcons();
    }
  }

  if (btnOpenReport) btnOpenReport.addEventListener('click', populateAndOpenReport);
  if (btnQuickReport) btnQuickReport.addEventListener('click', populateAndOpenReport);

  if (btnCloseReport) {
    btnCloseReport.addEventListener('click', () => {
      if (modalClinicalReport) modalClinicalReport.classList.add('hidden');
    });
  }

  if (btnPrintReport) {
    btnPrintReport.addEventListener('click', () => {
      window.print();
    });
  }

  // Fechar modal ao clicar fora
  if (modalClinicalReport) {
    modalClinicalReport.addEventListener('click', (e) => {
      if (e.target === modalClinicalReport) {
        modalClinicalReport.classList.add('hidden');
      }
    });
  }

  // Inicialização padrão na tela de Início (Home)
  navigateToView('home');
});
