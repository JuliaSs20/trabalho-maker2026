/**
 * BioPhysio AI - Motor de Análise Biomecânica (Fase 2)
 * Desenvolvido por: Arquitetura de Sistemas & Visão Computacional / IoT
 */

/**
 * 1€ Filter (One Euro Filter) para Suavização Adaptativa de Keypoints 3D
 * Reduz tremores em baixa velocidade e elimina lag em alta velocidade.
 */
class OneEuroFilter {
  constructor(freq = 30, minCutoff = 1.0, beta = 0.007, dCutoff = 1.0) {
    this.freq = freq;
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;

    this.xPrev = null;
    this.dxPrev = null;
    this.tPrev = null;
  }

  alpha(cutoff) {
    const tau = 1.0 / (2 * Math.PI * cutoff);
    const te = 1.0 / this.freq;
    return 1.0 / (1.0 + tau / te);
  }

  filter(val, timestamp = Date.now()) {
    if (this.tPrev === null) {
      this.xPrev = val;
      this.dxPrev = 0;
      this.tPrev = timestamp;
      return val;
    }

    const dt = Math.max((timestamp - this.tPrev) / 1000.0, 0.001);
    this.freq = 1.0 / dt;
    this.tPrev = timestamp;

    const dx = (val - this.xPrev) / dt;
    const edx = this.alpha(this.dCutoff) * dx + (1 - this.alpha(this.dCutoff)) * this.dxPrev;
    this.dxPrev = edx;

    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    const a = this.alpha(cutoff);
    const xFiltered = a * val + (1 - a) * this.xPrev;
    this.xPrev = xFiltered;

    return xFiltered;
  }

  reset() {
    this.xPrev = null;
    this.dxPrev = null;
    this.tPrev = null;
  }
}

/**
 * Gerenciador do Filtro 1€ para o Conjunto de Keypoints (33 landmarks do MediaPipe)
 */
class KeypointSpatialFilter {
  constructor(minCutoff = 1.0, beta = 0.007) {
    this.filtersX = [];
    this.filtersY = [];
    this.filtersZ = [];
    this.minCutoff = minCutoff;
    this.beta = beta;
  }

  initFilters(count) {
    this.filtersX = Array.from({ length: count }, () => new OneEuroFilter(30, this.minCutoff, this.beta));
    this.filtersY = Array.from({ length: count }, () => new OneEuroFilter(30, this.minCutoff, this.beta));
    this.filtersZ = Array.from({ length: count }, () => new OneEuroFilter(30, this.minCutoff, this.beta));
  }

  filter(landmarks) {
    if (!landmarks || landmarks.length === 0) return null;

    if (this.filtersX.length !== landmarks.length) {
      this.initFilters(landmarks.length);
    }

    const now = Date.now();
    return landmarks.map((lm, idx) => {
      if (lm.visibility !== undefined && lm.visibility < 0.4) {
        return lm;
      }

      const fx = this.filtersX[idx].filter(lm.x, now);
      const fy = this.filtersY[idx].filter(lm.y, now);
      const fz = lm.z !== undefined ? this.filtersZ[idx].filter(lm.z, now) : lm.z;

      return {
        x: fx,
        y: fy,
        z: fz,
        visibility: lm.visibility !== undefined ? lm.visibility : 1.0
      };
    });
  }

  reset() {
    this.filtersX.forEach(f => f.reset());
    this.filtersY.forEach(f => f.reset());
    this.filtersZ.forEach(f => f.reset());
  }
}

/**
 * Calculadora Biomecânica de Ângulos (Membros Inferiores & Superiores)
 */
class BiomechanicalEngine {
  /**
   * Ângulo interno 2D em graus formado pelos pontos A-B-C (Vértice em B)
   */
  static calculateAngle(pointA, pointB, pointC) {
    if (!pointA || !pointB || !pointC) return 0;

    const radians = Math.atan2(pointC.y - pointB.y, pointC.x - pointB.x) -
                    Math.atan2(pointA.y - pointB.y, pointA.x - pointB.x);
    let angle = Math.abs((radians * 180.0) / Math.PI);

    if (angle > 180.0) {
      angle = 360.0 - angle;
    }
    return angle;
  }

  /**
   * Ângulo 3D em graus formado por A-B-C considerando eixos x, y, z
   */
  static calculateAngle3D(pointA, pointB, pointC) {
    if (!pointA || !pointB || !pointC) return 0;

    const vAB = { x: pointA.x - pointB.x, y: pointA.y - pointB.y, z: (pointA.z || 0) - (pointB.z || 0) };
    const vCB = { x: pointC.x - pointB.x, y: pointC.y - pointB.y, z: (pointC.z || 0) - (pointB.z || 0) };

    const dot = vAB.x * vCB.x + vAB.y * vCB.y + vAB.z * vCB.z;
    const magAB = Math.sqrt(vAB.x * vAB.x + vAB.y * vAB.y + vAB.z * vAB.z);
    const magCB = Math.sqrt(vCB.x * vCB.x + vCB.y * vCB.y + vCB.z * vCB.z);

    if (magAB * magCB === 0) return 0;
    let cosTheta = dot / (magAB * magCB);
    cosTheta = Math.max(-1.0, Math.min(1.0, cosTheta));

    return (Math.acos(cosTheta) * 180.0) / Math.PI;
  }

  /**
   * Ângulo de inclinação do tronco em relação à linha vertical
   */
  static calculateTrunkInclination(shoulder, hip) {
    if (!shoulder || !hip) return 0;
    const dx = shoulder.x - hip.x;
    const dy = shoulder.y - hip.y;
    const angleRad = Math.atan2(Math.abs(dx), Math.abs(dy));
    return (angleRad * 180.0) / Math.PI;
  }

  /**
   * Ângulo de Abdução/Elevação do Ombro (braço com o tronco)
   */
  static calculateShoulderAbduction(hip, shoulder, elbow) {
    if (!hip || !shoulder || !elbow) return 0;
    return this.calculateAngle(hip, shoulder, elbow);
  }

  /**
   * Ângulo de Flexão/Extensão do Cotovelo (ombro - cotovelo - pulso)
   */
  static calculateElbowFlexion(shoulder, elbow, wrist) {
    if (!shoulder || !elbow || !wrist) return 0;
    return this.calculateAngle(shoulder, elbow, wrist);
  }

  /**
   * Ângulo de inclinação do braço em relação à horizontal
   */
  static calculateArmHorizontalAngle(shoulder, elbow) {
    if (!shoulder || !elbow) return 0;
    const dx = elbow.x - shoulder.x;
    const dy = elbow.y - shoulder.y;
    const angleRad = Math.atan2(Math.abs(dy), Math.abs(dx));
    return (angleRad * 180.0) / Math.PI;
  }

  /**
   * Avalia colapso medial do joelho (Valgo Dinâmico)
   */
  static detectKneeValgus(hip, knee, ankle) {
    if (!hip || !knee || !ankle) return { valgusDetected: false, ratio: 0 };
    const expectedX = hip.x + (ankle.x - hip.x) * 0.5;
    const medialShift = Math.abs(knee.x - expectedX);
    const hipAnkleWidth = Math.abs(hip.x - ankle.x) || 0.1;
    const ratio = medialShift / hipAnkleWidth;
    const valgusDetected = ratio > 0.22 && (knee.y > hip.y);
    return { valgusDetected, ratio: parseFloat(ratio.toFixed(3)) };
  }

  /**
   * Avalia elevação do calcanhar
   */
  static detectHeelLift(leftHeel, rightHeel, baselineY) {
    if (!leftHeel || !rightHeel || baselineY === null) return false;
    const currentY = (leftHeel.y + rightHeel.y) / 2;
    return (baselineY - currentY) > 0.035;
  }
}

/**
 * Regulador de Distância de Câmera (Camera Calibration Engine)
 */
class CameraDistanceRegulator {
  static evaluateDistance(landmarks) {
    if (!landmarks || landmarks.length < 33) {
      return { status: "WAITING", message: "Aguardando paciente no enquadramento", code: 0 };
    }

    const leftShoulder = landmarks[11];
    const rightShoulder = landmarks[12];
    const leftAnkle = landmarks[27];
    const rightAnkle = landmarks[28];

    if (!leftShoulder || !rightShoulder) {
      return { status: "WAITING", message: "Procurando ombros do paciente...", code: 0 };
    }

    const dx = rightShoulder.x - leftShoulder.x;
    const dy = rightShoulder.y - leftShoulder.y;
    const shoulderWidth = Math.sqrt(dx * dx + dy * dy);

    let bboxHeight = 0;
    if (leftAnkle && rightAnkle) {
      const avgShoulderY = (leftShoulder.y + rightShoulder.y) / 2;
      const avgAnkleY = (leftAnkle.y + rightAnkle.y) / 2;
      bboxHeight = Math.abs(avgAnkleY - avgShoulderY);
    }

    if (shoulderWidth > 0.38 || (bboxHeight > 0.85 && bboxHeight !== 0)) {
      return {
        status: "TOO_CLOSE",
        message: "⚠️ MUITO PERTO! Dê 1 ou 2 passos para TRÁS.",
        code: -1,
        shoulderWidth: parseFloat(shoulderWidth.toFixed(3))
      };
    } else if (shoulderWidth < 0.14) {
      return {
        status: "TOO_FAR",
        message: "⚠️ MUITO LONGE! Dê 1 ou 2 passos para FRENTE.",
        code: 1,
        shoulderWidth: parseFloat(shoulderWidth.toFixed(3))
      };
    } else {
      return {
        status: "IDEAL",
        message: "🟢 ENQUADRAMENTO IDEAL! Pode iniciar o exercício.",
        code: 2,
        shoulderWidth: parseFloat(shoulderWidth.toFixed(3))
      };
    }
  }
}

/**
 * Isolamento de Sujeito (Target Tracking Engine)
 */
class SubjectTracker {
  constructor() {
    this.targetId = null;
    this.targetCentroid = null;
    this.lockActive = false;
  }

  setTarget(x, y) {
    this.targetCentroid = { x, y };
    this.lockActive = true;
  }

  clearTarget() {
    this.targetId = null;
    this.targetCentroid = null;
    this.lockActive = false;
  }

  filterTargetPose(landmarks) {
    if (!this.lockActive || !landmarks || landmarks.length === 0) {
      return landmarks;
    }

    const ls = landmarks[11];
    const rs = landmarks[12];
    if (!ls || !rs) return landmarks;

    const currentCentroid = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 };

    if (!this.targetCentroid) {
      this.targetCentroid = currentCentroid;
      return landmarks;
    }

    const dist = Math.hypot(currentCentroid.x - this.targetCentroid.x, currentCentroid.y - this.targetCentroid.y);

    if (dist < 0.35) {
      this.targetCentroid = currentCentroid;
      return landmarks;
    } else {
      return null;
    }
  }
}

/**
 * Ponte de Comunicação IoT Arduino (Web Serial API)
 */
class ArduinoIoTBridge {
  constructor() {
    this.port = null;
    this.writer = null;
    this.connected = false;
    this.onStatusChange = null;
  }

  async connect() {
    if (!("serial" in navigator)) {
      throw new Error("Web Serial API não é suportada por este navegador. Use o Google Chrome ou Microsoft Edge.");
    }

    try {
      this.port = await navigator.serial.requestPort();
      await this.port.open({ baudRate: 115200 });
      
      const textEncoder = new TextEncoderStream();
      textEncoder.readable.pipeTo(this.port.writable);
      this.writer = textEncoder.writable.getWriter();

      this.connected = true;
      if (this.onStatusChange) this.onStatusChange(true, "Arduino Conectado (115200 Baud)");
      return true;
    } catch (err) {
      this.connected = false;
      if (this.onStatusChange) this.onStatusChange(false, `Falha IoT: ${err.message}`);
      throw err;
    }
  }

  async sendFeedback(status, rgbArray = [0, 255, 0], repCount = 0, angle = 0) {
    if (!this.connected || !this.writer) return;

    const payload = JSON.stringify({
      cmd: "FEEDBACK",
      status,
      rep: repCount,
      angle: Math.round(angle),
      rgb: rgbArray
    }) + "\n";

    try {
      await this.writer.write(payload);
    } catch (e) {
      console.warn("Erro no envio de dados IoT Arduino:", e);
    }
  }

  async disconnect() {
    if (this.writer) {
      await this.writer.close();
      this.writer = null;
    }
    if (this.port) {
      await this.port.close();
      this.port = null;
    }
    this.connected = false;
    if (this.onStatusChange) this.onStatusChange(false, "Arduino Desconectado");
  }
}

/**
 * Catálogo de Exercícios Fisioterapêuticos Modulares
 */
const ExerciseLibrary = {
  squat: {
    id: "squat",
    category: "Membros Inferiores",
    name: "Agachamento Terapêutico (Squat)",
    targetJointName: "Flexão Joelhos",
    unit: "deg",
    targetRange: "80.0° a 90.0°",
    evaluate: (landmarks, engineState) => {
      const leftHip = landmarks[23];
      const rightHip = landmarks[24];
      const leftKnee = landmarks[25];
      const rightKnee = landmarks[26];
      const leftAnkle = landmarks[27];
      const rightAnkle = landmarks[28];
      const leftShoulder = landmarks[11];
      const rightShoulder = landmarks[12];
      const leftHeel = landmarks[29];
      const rightHeel = landmarks[30];

      const leftKneeAngle = BiomechanicalEngine.calculateAngle(leftHip, leftKnee, leftAnkle);
      const rightKneeAngle = BiomechanicalEngine.calculateAngle(rightHip, rightKnee, rightAnkle);
      const mainAngle = (leftKneeAngle + rightKneeAngle) / 2;

      const leftTrunk = BiomechanicalEngine.calculateTrunkInclination(leftShoulder, leftHip);
      const rightTrunk = BiomechanicalEngine.calculateTrunkInclination(rightShoulder, rightHip);
      const trunkAngle = (leftTrunk + rightTrunk) / 2;

      const leftValgus = BiomechanicalEngine.detectKneeValgus(leftHip, leftKnee, leftAnkle);
      const rightValgus = BiomechanicalEngine.detectKneeValgus(rightHip, rightKnee, rightAnkle);
      const valgoDinamico = leftValgus.valgusDetected || rightValgus.valgusDetected;
      const troncoExcessivo = trunkAngle > 45.0;
      const calcanharElevado = BiomechanicalEngine.detectHeelLift(leftHeel, rightHeel, engineState.groundBaselineY);

      let phase = engineState.currentState;
      let repCompleted = false;
      let isCorrectRep = false;

      if (phase === "standing" && mainAngle < 155.0) {
        phase = "eccentric";
        engineState.resetRepFaults();
      } else if (phase === "eccentric") {
        if (mainAngle <= 92.0 && mainAngle >= 78.0) {
          phase = "bottom_hold";
        } else if (mainAngle > 160.0) {
          phase = "standing";
        }
      } else if (phase === "bottom_hold" && mainAngle > 95.0) {
        phase = "concentric";
      } else if (phase === "concentric" && mainAngle >= 165.0) {
        repCompleted = true;
        isCorrectRep = !engineState.hasFaultInCurrentRep;
        phase = "standing";
      }

      if (valgoDinamico || troncoExcessivo || calcanharElevado) {
        engineState.hasFaultInCurrentRep = true;
      }

      let status = "EXCELENTE";
      let feedback = "Excelente postura! Mantenha os joelhos alinhados.";
      let rgb = [0, 255, 0];

      if (valgoDinamico) {
        status = "CORRIGIR";
        feedback = "⚠️ ALERTA: Mantenha os joelhos para fora! Não deixe colapsar.";
        rgb = [255, 0, 0];
      } else if (troncoExcessivo) {
        status = "ATENÇÃO";
        feedback = "⚠️ Mantenha o peito aberto. Tronco muito inclinado.";
        rgb = [255, 165, 0];
      } else if (calcanharElevado) {
        status = "ATENÇÃO";
        feedback = "⚠️ Mantenha os calcanhares firmes no chão.";
        rgb = [255, 165, 0];
      }

      return {
        mainAngle,
        secondaryAngle: trunkAngle,
        phase,
        repCompleted,
        isCorrectRep,
        status,
        feedback,
        rgb,
        faults: { valgoDinamico, troncoExcessivo, calcanharElevado }
      };
    }
  },

  shoulder_abduction: {
    id: "shoulder_abduction",
    category: "Membros Superiores",
    name: "Abdução de Ombro (Elevação Lateral)",
    targetJointName: "Abdução Ombro",
    unit: "deg",
    targetRange: "85.0° a 95.0°",
    evaluate: (landmarks, engineState) => {
      const leftShoulder = landmarks[11];
      const rightShoulder = landmarks[12];
      const leftElbow = landmarks[13];
      const rightElbow = landmarks[14];
      const leftHip = landmarks[23];
      const rightHip = landmarks[24];

      const leftAngle = BiomechanicalEngine.calculateShoulderAbduction(leftHip, leftShoulder, leftElbow);
      const rightAngle = BiomechanicalEngine.calculateShoulderAbduction(rightHip, rightShoulder, rightElbow);
      const mainAngle = Math.max(leftAngle, rightAngle);

      const trunkAngle = (BiomechanicalEngine.calculateTrunkInclination(leftShoulder, leftHip) + 
                          BiomechanicalEngine.calculateTrunkInclination(rightShoulder, rightHip)) / 2;

      const troncoInclinado = trunkAngle > 15.0;
      const hiperabducao = mainAngle > 105.0;

      let phase = engineState.currentState;
      let repCompleted = false;
      let isCorrectRep = false;

      if (phase === "standing" && mainAngle > 30.0) {
        phase = "eccentric";
        engineState.resetRepFaults();
      } else if (phase === "eccentric" && mainAngle >= 85.0) {
        phase = "bottom_hold";
      } else if (phase === "bottom_hold" && mainAngle < 80.0) {
        phase = "concentric";
      } else if (phase === "concentric" && mainAngle <= 25.0) {
        repCompleted = true;
        isCorrectRep = !engineState.hasFaultInCurrentRep;
        phase = "standing";
      }

      if (troncoInclinado || hiperabducao) engineState.hasFaultInCurrentRep = true;

      let status = "EXCELENTE";
      let feedback = "Elevação lateral sob controle! Alvo 90°.";
      let rgb = [0, 255, 0];

      if (hiperabducao) {
        status = "CORRIGIR";
        feedback = "⚠️ Cuidado! Não eleve o braço acima da linha dos ombros (> 95°).";
        rgb = [255, 0, 0];
      } else if (troncoInclinado) {
        status = "ATENÇÃO";
        feedback = "⚠️ Evite balançar o corpo para subir o peso. Mantenha o tronco firme.";
        rgb = [255, 165, 0];
      }

      return {
        mainAngle,
        secondaryAngle: trunkAngle,
        phase,
        repCompleted,
        isCorrectRep,
        status,
        feedback,
        rgb,
        faults: { hiperabducao, troncoInclinado }
      };
    }
  },

  biceps_curl: {
    id: "biceps_curl",
    category: "Membros Superiores",
    name: "Rosca Direta de Bíceps",
    targetJointName: "Flexão Cotovelo",
    unit: "deg",
    targetRange: "45.0° a 180.0°",
    evaluate: (landmarks, engineState) => {
      const rightShoulder = landmarks[12];
      const rightElbow = landmarks[14];
      const rightWrist = landmarks[16];

      // O sensor fica no braço direito; use apenas esse lado para o ângulo e as repetições.
      const rightElbowAngle = BiomechanicalEngine.calculateElbowFlexion(rightShoulder, rightElbow, rightWrist);
      const mainAngle = rightElbowAngle;

      const elbowDisplacement = Math.abs(rightElbow.x - rightShoulder.x);
      const cotoveloProjetado = elbowDisplacement > 0.12;
      const cotoveloNaFlexaoAlvo = Math.abs(mainAngle - 45.0) <= 5.0;
      const cotoveloTotalmenteEstendido = mainAngle >= 165.0;

      let phase = engineState.currentState;
      let repCompleted = false;
      let isCorrectRep = false;

      if (phase === "standing" && mainAngle < 140.0) {
        phase = "eccentric";
        engineState.resetRepFaults();
      } else if (phase === "eccentric" && mainAngle <= 50.0) {
        phase = "bottom_hold";
      } else if (phase === "bottom_hold" && mainAngle > 60.0) {
        phase = "concentric";
      } else if (phase === "concentric" && mainAngle >= 150.0) {
        repCompleted = true;
        isCorrectRep = !engineState.hasFaultInCurrentRep;
        phase = "standing";
      }

      if (cotoveloProjetado) engineState.hasFaultInCurrentRep = true;

      let status = "EXCELENTE";
      let feedback = "Movimento limpo! Contraia o bíceps no topo.";
      let rgb = [0, 255, 0];

      if (cotoveloNaFlexaoAlvo) {
        status = "EXCELENTE";
        feedback = "✅ Flexão próxima de 45°. Boa contração do bíceps!";
        rgb = [0, 255, 0];
      } else if (cotoveloTotalmenteEstendido) {
        status = "ATENÇÃO";
        feedback = "⚠️ O cotovelo está quase totalmente estendido. Flexione um pouco mais o braço.";
        rgb = [255, 165, 0];
      }

      if (cotoveloProjetado && !cotoveloNaFlexaoAlvo) {
        status = "ATENÇÃO";
        feedback = cotoveloTotalmenteEstendido
          ? "⚠️ Flexione um pouco o cotovelo e mantenha-o ao lado do tronco."
          : "⚠️ Mantenha o cotovelo ao lado do tronco; não o jogue para frente.";
        rgb = [255, 165, 0];
      }

      return {
        mainAngle,
        secondaryAngle: elbowDisplacement * 100,
        phase,
        repCompleted,
        isCorrectRep,
        status,
        feedback,
        rgb,
        faults: { cotoveloProjetado, cotoveloTotalmenteEstendido, cotoveloNaFlexaoAlvo }
      };
    }
  },

  triceps_extension: {
    id: "triceps_extension",
    category: "Membros Superiores",
    name: "Extensão de Tríceps (Coice)",
    targetJointName: "Extensão Cotovelo",
    unit: "deg",
    targetRange: "165.0° a 180.0°",
    evaluate: (landmarks, engineState) => {
      const leftShoulder = landmarks[11];
      const rightShoulder = landmarks[12];
      const leftElbow = landmarks[13];
      const rightElbow = landmarks[14];
      const leftWrist = landmarks[15];
      const rightWrist = landmarks[16];

      const leftElbowAngle = BiomechanicalEngine.calculateElbowFlexion(leftShoulder, leftElbow, leftWrist);
      const rightElbowAngle = BiomechanicalEngine.calculateElbowFlexion(rightShoulder, rightElbow, rightWrist);
      const mainAngle = Math.max(leftElbowAngle, rightElbowAngle);

      const armAngle = BiomechanicalEngine.calculateArmHorizontalAngle(leftShoulder, leftElbow);
      const bracoQueda = armAngle > 30.0;

      let phase = engineState.currentState;
      let repCompleted = false;
      let isCorrectRep = false;

      if (phase === "standing" && mainAngle > 110.0) {
        phase = "eccentric";
        engineState.resetRepFaults();
      } else if (phase === "eccentric" && mainAngle >= 165.0) {
        phase = "bottom_hold";
      } else if (phase === "bottom_hold" && mainAngle < 155.0) {
        phase = "concentric";
      } else if (phase === "concentric" && mainAngle <= 95.0) {
        repCompleted = true;
        isCorrectRep = !engineState.hasFaultInCurrentRep;
        phase = "standing";
      }

      if (bracoQueda) engineState.hasFaultInCurrentRep = true;

      let status = "EXCELENTE";
      let feedback = "Extensão completa do tríceps! Excelente trava.";
      let rgb = [0, 255, 0];

      if (bracoQueda) {
        status = "ATENÇÃO";
        feedback = "⚠️ Mantenha o braço alinhado em paralelo ao solo. Não deixe o cotovelo cair.";
        rgb = [255, 165, 0];
      }

      return {
        mainAngle,
        secondaryAngle: armAngle,
        phase,
        repCompleted,
        isCorrectRep,
        status,
        feedback,
        rgb,
        faults: { bracoQueda }
      };
    }
  }
};

/**
 * Motor Unificado de Análise Fisioterapêutica (TherapeuticExerciseAnalyzer)
 */
class TherapeuticExerciseAnalyzer {
  constructor(exerciseId = "squat") {
    this.spatialFilter = new KeypointSpatialFilter(1.0, 0.007);
    this.subjectTracker = new SubjectTracker();
    this.iotBridge = new ArduinoIoTBridge();

    this.currentExerciseKey = exerciseId;
    this.totalReps = 0;
    this.correctReps = 0;
    this.faultReps = 0;
    this.frameCounter = 0;

    this.currentState = "standing";
    this.hasFaultInCurrentRep = false;
    this.groundBaselineY = null;
  }

  setExercise(exerciseId) {
    if (ExerciseLibrary[exerciseId]) {
      this.currentExerciseKey = exerciseId;
      this.resetSession();
    }
  }

  resetRepFaults() {
    this.hasFaultInCurrentRep = false;
  }

  resetSession() {
    this.totalReps = 0;
    this.correctReps = 0;
    this.faultReps = 0;
    this.frameCounter = 0;
    this.currentState = "standing";
    this.hasFaultInCurrentRep = false;
    this.groundBaselineY = null;
    this.spatialFilter.reset();
  }

  processFrame(rawLandmarks, useFilter = true) {
    this.frameCounter++;
    const timestamp = Date.now();

    // 1. Isolamento de Sujeito (Target Tracking)
    const trackedLandmarks = this.subjectTracker.filterTargetPose(rawLandmarks);
    if (!trackedLandmarks) {
      return this.buildOutputData(timestamp, "Aguardando paciente foco no enquadramento...", null, null);
    }

    // 2. Filtragem 1€ (One Euro Filter)
    const landmarks = useFilter ? this.spatialFilter.filter(trackedLandmarks) : trackedLandmarks;

    if (!landmarks || landmarks.length < 33) {
      return this.buildOutputData(timestamp, "Aguardando detecção completa de keypoints...", null, null);
    }

    // 3. Avaliação de Regulagem de Distância da Câmera
    const distanceEval = CameraDistanceRegulator.evaluateDistance(landmarks);

    // Baseline Solo
    if (this.groundBaselineY === null && landmarks[29] && landmarks[30]) {
      this.groundBaselineY = (landmarks[29].y + landmarks[30].y) / 2;
    }

    // 4. Seleção da Estratégia de Exercício
    const exerciseConfig = ExerciseLibrary[this.currentExerciseKey] || ExerciseLibrary.squat;
    const result = exerciseConfig.evaluate(landmarks, this);

    this.currentState = result.phase;

    if (result.repCompleted) {
      this.totalReps++;
      if (result.isCorrectRep) {
        this.correctReps++;
      } else {
        this.faultReps++;
      }
      if (this.iotBridge.connected) {
        this.iotBridge.sendFeedback(
          result.isCorrectRep ? "CORRECT" : "FAULT",
          result.rgb,
          this.totalReps,
          result.mainAngle
        );
      }
    }

    return {
      timestamp,
      frameId: this.frameCounter,
      exercicio: exerciseConfig.name,
      exerciseKey: this.currentExerciseKey,
      targetJointName: exerciseConfig.targetJointName,
      unit: exerciseConfig.unit,
      targetRange: exerciseConfig.targetRange,
      faseMovimento: this.currentState,
      repeticoes: {
        completas: this.totalReps,
        corretas: this.correctReps,
        comCompensacao: this.faultReps
      },
      angulosAtuais: {
        principalDeg: parseFloat(result.mainAngle.toFixed(1)),
        secundarioDeg: parseFloat(result.secondaryAngle.toFixed(1))
      },
      qualidadeExecucao: {
        status: result.status,
        mensagemFeedback: result.feedback
      },
      distanceEval,
      landmarksProcessed: landmarks
    };
  }

  processSensorAngle(angleDeg) {
    const protocols = {
      squat: { start: 155, target: 92, startDirection: "above", targetDirection: "below", targetRange: "78° a 92°" },
      shoulder_abduction: { start: 150, target: 95, startDirection: "above", targetDirection: "below", targetRange: "85° a 95°" },
      biceps_curl: { start: 2.5, target: 42.5, startDirection: "below", targetDirection: "above", targetRange: "22.5° a 45°" },
      triceps_extension: { start: 95, target: 165, startDirection: "below", targetDirection: "above", targetRange: "165° a 180°" }
    };
    const exerciseConfig = ExerciseLibrary[this.currentExerciseKey] || ExerciseLibrary.squat;
    const protocol = protocols[this.currentExerciseKey] || protocols.squat;
    const targetRange = this.currentExerciseKey === "biceps_curl"
      ? "22.5° a 45.0°"
      : exerciseConfig.targetRange;
    const rangeBounds = targetRange.match(/([\d.]+)°\s*a\s*([\d.]+)°/);
    const targetMin = rangeBounds ? Number(rangeBounds[1]) : 80;
    const targetMax = rangeBounds ? Number(rangeBounds[2]) : 90;
    protocol.target = this.currentExerciseKey === "biceps_curl"
      ? targetMax
      : protocol.targetDirection === "above" ? targetMin : targetMax;
    protocol.targetRange = targetRange;
    const isAtThreshold = (value, threshold, direction) =>
      direction === "above" ? value >= threshold : value <= threshold;
    const isAtStart = isAtThreshold(angleDeg, protocol.start, protocol.startDirection);
    const isAtTarget = isAtThreshold(angleDeg, protocol.target, protocol.targetDirection);
    let repCompleted = false;

    if (this.currentState === "standing" && !isAtStart) {
      this.currentState = "eccentric";
    } else if (this.currentState === "eccentric" && isAtTarget) {
      this.currentState = "bottom_hold";
    } else if (this.currentState === "eccentric" && isAtStart) {
      this.currentState = "standing";
    } else if (this.currentState === "bottom_hold" && !isAtTarget) {
      this.currentState = "concentric";
    } else if (this.currentState === "concentric" && isAtStart) {
      this.currentState = "standing";
      repCompleted = true;
      this.totalReps++;
      this.correctReps++;
    }

    const inTargetRange = angleDeg >= targetMin && angleDeg <= targetMax;
    const feedback = repCompleted
      ? "Repetição registrada por amplitude. O sensor não avalia alinhamento ou postura."
      : inTargetRange
        ? "Amplitude dentro da faixa-alvo. O sensor não avalia alinhamento ou postura."
        : `Leitura do sensor: ${angleDeg.toFixed(1)}°. Faixa-alvo: ${protocol.targetRange}.`;

    return {
      timestamp: Date.now(),
      frameId: ++this.frameCounter,
      exercicio: exerciseConfig.name,
      exerciseKey: this.currentExerciseKey,
      targetJointName: exerciseConfig.targetJointName,
      unit: exerciseConfig.unit,
      targetRange: protocol.targetRange,
      faseMovimento: this.currentState,
      repeticoes: {
        completas: this.totalReps,
        corretas: this.correctReps,
        comCompensacao: this.faultReps
      },
      angulosAtuais: {
        principalDeg: angleDeg,
        secundarioDeg: 0
      },
      qualidadeExecucao: {
        status: inTargetRange ? "EXCELENTE" : "ATENÇÃO",
        mensagemFeedback: feedback
      },
      distanceEval: {
        status: "WAITING",
        message: "Avaliação por ângulo BLE; alinhamento e postura não são verificados pelo sensor.",
        code: 0
      },
      landmarksProcessed: null,
      sensorTelemetry: true
    };
  }

  buildOutputData(timestamp, msg, landmarks, distanceEval) {
    const exerciseConfig = ExerciseLibrary[this.currentExerciseKey] || ExerciseLibrary.squat;
    return {
      timestamp,
      frameId: this.frameCounter,
      exercicio: exerciseConfig.name,
      exerciseKey: this.currentExerciseKey,
      targetJointName: exerciseConfig.targetJointName,
      unit: exerciseConfig.unit,
      targetRange: exerciseConfig.targetRange,
      faseMovimento: "Aguardando",
      repeticoes: { completas: this.totalReps, corretas: this.correctReps, comCompensacao: this.faultReps },
      angulosAtuais: { principalDeg: 0, secundarioDeg: 0 },
      qualidadeExecucao: { status: "ATENÇÃO", mensagemFeedback: msg },
      distanceEval: distanceEval || { status: "WAITING", message: msg, code: 0 },
      landmarksProcessed: landmarks
    };
  }

  formatJSONProtocol(data, cameraName = "Câmera BioPhysio IoT - Vista Frontal") {
    if (!data || !data.angulosAtuais) {
      return JSON.stringify({
        status_execucao: "Ajuste Necessário",
        feedback_paciente: "Aguardando enquadramento...",
        dados_camera_ativa: cameraName
      }, null, 2);
    }

    return JSON.stringify({
      status_execucao: data.sensorTelemetry
        ? data.qualidadeExecucao.status === "EXCELENTE" ? "Amplitude na faixa-alvo" : "Amplitude fora da faixa-alvo"
        : data.qualidadeExecucao.status === "EXCELENTE" ? "Correto" : "Incorreto",
      feedback_paciente: data.qualidadeExecucao.mensagemFeedback,
      distancia_camera: data.distanceEval ? data.distanceEval.message : "Desconhecida",
      dados_camera_ativa: cameraName,
      limites_avaliacao: data.sensorTelemetry
        ? "Apenas amplitude angular; postura e compensações não avaliadas."
        : undefined,
      telemetria_detalhada: {
        timestamp_ms: data.timestamp,
        frame_id: data.frameId,
        exercicio: data.exercicio,
        fase_movimento: data.faseMovimento,
        repeticoes: data.repeticoes,
        angulo_principal_deg: data.angulosAtuais.principalDeg
      }
    }, null, 2);
  }
}

class TherapeuticSquatAnalyzer extends TherapeuticExerciseAnalyzer {
  constructor() {
    super("squat");
  }
}

window.OneEuroFilter = OneEuroFilter;
window.KeypointSpatialFilter = KeypointSpatialFilter;
window.BiomechanicalEngine = BiomechanicalEngine;
window.CameraDistanceRegulator = CameraDistanceRegulator;
window.SubjectTracker = SubjectTracker;
window.ArduinoIoTBridge = ArduinoIoTBridge;
window.ExerciseLibrary = ExerciseLibrary;
window.TherapeuticExerciseAnalyzer = TherapeuticExerciseAnalyzer;
window.TherapeuticSquatAnalyzer = TherapeuticSquatAnalyzer;
