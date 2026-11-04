/**
 * ============================================================================
 * BioPhysio AI - Integração IoT: Web Bluetooth API & Calibração Leanstar
 * Papel: Engenheiro de IoT & Desenvolvedor Web Front-end
 * ============================================================================
 */

// ============================================================================
// BLOCO 3: LÓGICA DE CALIBRAÇÃO, FILTRAGEM PASSA-BAIXA E CONVERSÃO ANGULAR
// ============================================================================

/**
 * Filtro Combinado (Média Móvel + Passa-Baixa Exponencial EMA)
 * Evita que o ângulo "trema" (jitter) na tela do paciente devido à oscilação
 * analógica natural das fitas resistivas de carbono/polímero (Leanstar).
 */
class LeanstarSignalFilter {
  constructor(windowSize = 5, alpha = 0.25) {
    this.windowSize = windowSize; // Tamanho da janela da Média Móvel
    this.alpha = alpha;           // Fator de suavização EMA (0.05 = super suave, 1.0 = sem filtro)
    this.buffer = [];
    this.emaValue = null;
  }

  /**
   * Processa uma nova amostra bruta (Voltagem ou ADC) e retorna o sinal estabilizado
   */
  process(rawSample) {
    if (typeof rawSample !== 'number' || isNaN(rawSample)) return 0;

    // 1. Média Móvel Simples (Remove spikes/ruídos impulsivos de curta duração)
    this.buffer.push(rawSample);
    if (this.buffer.length > this.windowSize) {
      this.buffer.shift();
    }
    const movingAvg = this.buffer.reduce((acc, val) => acc + val, 0) / this.buffer.length;

    // 2. Filtro Passa-Baixa Exponencial (EMA - Exponential Moving Average)
    // Garante transição fluida nos ponteiros e medidores visuais da interface
    if (this.emaValue === null) {
      this.emaValue = movingAvg;
    } else {
      this.emaValue = (this.alpha * movingAvg) + ((1.0 - this.alpha) * this.emaValue);
    }

    return this.emaValue;
  }

  reset() {
    this.buffer = [];
    this.emaValue = null;
  }
}

/**
 * Motor de Calibração e Mapeamento Voltagem -> Ângulo Articular (0° a 180°)
 */
class LeanstarAngleConverter {
  constructor() {
    // Valores padrão iniciais (Volts) caso o paciente ainda não tenha calibrado
    this.voltageStraight180Deg = 2.150; // Braço estendido (180°)
    // A tensão de referência corresponde ao limite de flexão configurado em 45°.
    this.voltageBent45Deg = 1.687; // Braço flexionado (45°)
    // A calibração pertence ao sensor, não ao exercício selecionado. Assim,
    // agachamento e rosca direta sempre reutilizam os mesmos pontos de leitura.
    this.calibrationStorageKey = "leanstar-angle-calibration-v1";
    this.loadCalibration();
    // Menos suavização para acompanhar a flexão com menor atraso, mantendo
    // uma pequena média móvel para reduzir oscilações entre amostras.
    this.filter = new LeanstarSignalFilter(2, 0.65);
    this.lastFilteredVoltage = 2.150;
  }

  loadCalibration() {
    try {
      if (typeof localStorage === "undefined") return;
      const saved = JSON.parse(localStorage.getItem(this.calibrationStorageKey) || "null");
      const straight = Number(saved && saved.voltageStraight180Deg);
      const bent = Number(saved && saved.voltageBent45Deg);
      if (Number.isFinite(straight) && Number.isFinite(bent) &&
          straight >= 0 && straight <= 3.3 && bent >= 0 && bent <= 3.3 &&
          Math.abs(straight - bent) >= 0.02) {
        this.voltageStraight180Deg = straight;
        this.voltageBent45Deg = bent;
      }
    } catch (error) {
      console.warn("[CALIBRAÇÃO LEANSTAR] Não foi possível carregar a calibração salva:", error);
    }
  }

  saveCalibration() {
    try {
      if (typeof localStorage === "undefined") return;
      localStorage.setItem(this.calibrationStorageKey, JSON.stringify({
        voltageStraight180Deg: this.voltageStraight180Deg,
        voltageBent45Deg: this.voltageBent45Deg
      }));
    } catch (error) {
      console.warn("[CALIBRAÇÃO LEANSTAR] Não foi possível salvar a calibração:", error);
    }
  }

  /**
   * Calibra o ponto de extensão total (braço estendido = 180°)
   * @param {number} currentVoltage Tensão lida com o braço estendido a 180°
   */
  calibrateExtension180Degrees(currentVoltage = this.lastFilteredVoltage) {
    this.voltageStraight180Deg = currentVoltage;
    this.saveCalibration();
    console.info(`[CALIBRAÇÃO LEANSTAR] Braço estendido (180°) salvo em: ${currentVoltage.toFixed(3)} V`);
    return this.voltageStraight180Deg;
  }

  /**
   * Calibra o ponto de flexão de referência (braço flexionado = 45°)
   * @param {number} currentVoltage Tensão lida com o braço flexionado a 45°
   */
  calibrateFlexed45Degrees(currentVoltage = this.lastFilteredVoltage) {
    // Evita divisão por zero caso o usuário clique nos dois botões na mesma posição
    if (Math.abs(currentVoltage - this.voltageStraight180Deg) < 0.02) {
      console.warn("[CALIBRAÇÃO LEANSTAR] A variação de tensão entre 180° e 45° é muito pequena! Dobre mais a fita.");
      return this.voltageBent45Deg;
    }
    this.voltageBent45Deg = currentVoltage;
    this.saveCalibration();
    console.info(`[CALIBRAÇÃO LEANSTAR] Braço flexionado (45°) salvo em: ${currentVoltage.toFixed(3)} V`);
    return this.voltageBent45Deg;
  }

  /**
   * Converte a voltagem recebida em um ângulo articular suavizado (0° a 180°)
   * Utiliza interpolação/extrapolação linear calibrada com clamping seguro.
   */
  voltageToAngle(rawVoltage) {
    // 1. Filtra o ruído analógico da fita Leanstar
    const cleanVoltage = this.filter.process(rawVoltage);
    this.lastFilteredVoltage = cleanVoltage;

    // 2. Interpolação entre braço estendido (180°) e flexionado (45°).
    const deltaVCalib = this.voltageBent45Deg - this.voltageStraight180Deg;
    if (Math.abs(deltaVCalib) < 0.001) return NaN;

    const flexionProgress = (cleanVoltage - this.voltageStraight180Deg) / deltaVCalib;
    let angleDeg = 180.0 - (flexionProgress * 135.0);

    // 3. Limita a leitura ao intervalo esperado: 45° flexionado a 180° estendido.
    angleDeg = Math.max(45.0, Math.min(180.0, angleDeg));

    return parseFloat(angleDeg.toFixed(1));
  }
}

// ============================================================================
// BLOCO 2: COMUNICAÇÃO WEB BLUETOOTH API (PAREAMENTO E STREAMING BLE)
// ============================================================================

class LeanstarBLEManager {
  constructor(onDataCallback, onStatusCallback) {
    this.BLE_PROFILES = [
      {
        serviceUuid: "0000ffe0-0000-1000-8000-00805f9b34fb",
        characteristicUuid: "0000ffe1-0000-1000-8000-00805f9b34fb",
        format: "text"
      },
      {
        serviceUuid: "19b10000-e8f2-537e-4f6c-d104768a1214",
        characteristicUuid: "19b10001-e8f2-537e-4f6c-d104768a1214",
        format: "leanstar-packet"
      }
    ];

    this.device = null;
    this.server = null;
    this.characteristic = null;
    this.activeProfile = null;
    this.isConnected = false;
    this.readTimer = null;
    this.textFlushTimer = null;
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
    this.isConnecting = false;
    this.isReconnecting = false;
    this.shouldReconnect = false;
    this.disconnectRequested = false;
    this.disconnectHandler = null;
    this.listenerDevice = null;
    this.textBuffer = "";
    this.isReading = false;
    this.lastNotificationAt = 0;

    this.onDataCallback = onDataCallback || (() => {});
    this.onStatusCallback = onStatusCallback || (() => {});
    this.decoder = new TextDecoder('utf-8');
    this.angleConverter = new LeanstarAngleConverter();
    // The Arduino sketch sends 0% at extension and 100% at flexion.
    // Map that range to the elbow's expected 180°-to-45° interior angle.
    this.extendedAngleDeg = 180;
    this.flexedAngleDeg = 45;
  }

  /**
   * Solicita pareamento com o microcontrolador via navegador (Web Bluetooth API)
   */
  async connect() {
     if (window.location.protocol === "file:") {
       throw new Error("O seletor Bluetooth não abre quando o site é aberto como arquivo. Inicie o servidor e acesse http://localhost:8080.");
    }
    if (!window.isSecureContext) {
       throw new Error("O Bluetooth foi bloqueado por uma conexão não segura. Use http://localhost:8080 ou publique o site em HTTPS.");
    }
     if (!navigator.bluetooth) {
       throw new Error("Este navegador não oferece Web Bluetooth. Use Chrome ou Edge com Bluetooth BLE; no iPhone, páginas do Safari não podem parear com o HM-06.");
     }

    try {
      console.log("[WEB BLE] Procurando sensor HM-06...");
      
      // HM-06 BLE UART modules commonly expose FFE0/FFE1.
      this.device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: this.BLE_PROFILES.map((profile) => profile.serviceUuid)
      });

      this.disconnectRequested = false;
      this.shouldReconnect = false;
      this.isReconnecting = false;
      this.reconnectAttempts = 0;
      if (this.listenerDevice && this.listenerDevice !== this.device && this.disconnectHandler) {
        this.listenerDevice.removeEventListener('gattserverdisconnected', this.disconnectHandler);
      }
      if (!this.disconnectHandler) {
        this.disconnectHandler = () => this.handleDisconnection();
      }
      if (this.listenerDevice !== this.device) {
        this.device.addEventListener('gattserverdisconnected', this.disconnectHandler);
        this.listenerDevice = this.device;
      }
      await this.openGattConnection();
      this.shouldReconnect = true;
      console.log("[WEB BLE] Pareado com sucesso! Recebendo ângulos do sensor...");
      return true;
    } catch (error) {
      console.error("[WEB BLE] Erro ao conectar:", error);
      this.isConnected = false;
      if (this.readTimer !== null) window.clearInterval(this.readTimer);
      if (this.textFlushTimer !== null) window.clearTimeout(this.textFlushTimer);
      this.readTimer = null;
      this.textFlushTimer = null;
      this.textBuffer = "";
      this.shouldReconnect = false;
      this.isReconnecting = false;
      if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
      if (this.device && this.device.gatt && this.device.gatt.connected) {
        this.device.gatt.disconnect();
      }
      throw error;
    }
  }

  async openGattConnection() {
    if (!this.device || !this.device.gatt || this.isConnecting) return false;
    this.isConnecting = true;
    try {
      console.log(`[WEB BLE] Conectando ao GATT Server de ${this.device.name || "sensor selecionado"}...`);
      this.server = await this.device.gatt.connect();
      this.characteristic = null;
      this.activeProfile = null;

      for (const profile of this.BLE_PROFILES) {
        try {
          const service = await this.server.getPrimaryService(profile.serviceUuid);
          this.characteristic = await service.getCharacteristic(profile.characteristicUuid);
          this.activeProfile = profile;
          break;
        } catch (error) {
          if (!error || error.name !== "NotFoundError") throw error;
        }
      }

      if (!this.characteristic) {
        throw new Error("O dispositivo conectou, mas não oferece um serviço de ângulo compatível (HM-06 FFE0/FFE1 ou BioPhysio Leanstar).");
      }

      const supportsNotifications = this.characteristic.properties.notify || this.characteristic.properties.indicate;
      if (supportsNotifications) {
        this.characteristic.addEventListener(
          'characteristicvaluechanged',
          (event) => this.handleDataChanged(event)
        );
        await this.characteristic.startNotifications();
      } else if (!this.characteristic.properties.read) {
        throw new Error("A característica Bluetooth não permite notificações nem leitura do ângulo.");
      }

      this.isConnected = true;
      this.isReconnecting = false;
      this.reconnectAttempts = 0;
      this.lastNotificationAt = Date.now();
      this.onStatusCallback(true, this.device.name || "HM-06", false);
      if (this.characteristic.properties.read) {
        this.readCurrentValue();
        this.readTimer = window.setInterval(() => {
          const notificationsStalled = Date.now() - this.lastNotificationAt > 1000;
          if (!supportsNotifications || notificationsStalled) this.readCurrentValue();
        }, 200);
      }
      return true;
    } finally {
      this.isConnecting = false;
    }
  }

  scheduleReconnect() {
    if (!this.shouldReconnect || this.disconnectRequested || this.reconnectTimer !== null) return;
    this.isReconnecting = true;
    this.reconnectAttempts += 1;
    const delayMs = Math.min(10000, 1000 * (2 ** Math.min(this.reconnectAttempts - 1, 4)));
    this.onStatusCallback(false, this.device ? this.device.name || "HM-06" : "HM-06", true);
    console.warn(`[WEB BLE] Reconexão ${this.reconnectAttempts} em ${delayMs / 1000}s...`);
    this.reconnectTimer = window.setTimeout(async () => {
      this.reconnectTimer = null;
      if (!this.shouldReconnect || this.disconnectRequested || !this.device || !this.device.gatt) return;
      try {
        await this.openGattConnection();
      } catch (error) {
        console.warn("[WEB BLE] Tentativa de reconexão falhou:", error);
        this.scheduleReconnect();
      }
    }, delayMs);
  }

  handleDataChanged(event) {
    this.lastNotificationAt = Date.now();
    this.handleCharacteristicValue(event.target.value);
  }

  async readCurrentValue() {
    if (!this.isConnected || this.isReading || !this.characteristic || !this.characteristic.properties.read) return;
    this.isReading = true;
    try {
      const value = await this.characteristic.readValue();
      if (this.isConnected) this.handleCharacteristicValue(value, true);
    } catch (error) {
      console.warn("[BLE STREAM] Não foi possível ler o valor atual do sensor:", error);
    } finally {
      this.isReading = false;
    }
  }

  handleCharacteristicValue(dataView, flushText = false) {
    if (this.activeProfile && this.activeProfile.format === "leanstar-packet" && dataView.byteLength >= 12) {
      const rawAdc = dataView.getUint16(0, true);
      const voltage = dataView.getFloat32(4, true);
      const resistanceOhms = dataView.getFloat32(8, true);
      if (Number.isFinite(voltage) && voltage >= 0 && voltage <= 3.3) {
        const angleDeg = this.angleConverter.voltageToAngle(voltage);
        this.onDataCallback({
          timestamp: Date.now(),
          angleDeg,
          rawValue: `${voltage.toFixed(3)} V`,
          rawAdc,
          voltage,
          resistanceOhms
        });
        return;
      }
      console.warn("[BLE STREAM] Pacote Leanstar inválido; tensão fora do intervalo esperado.");
      return;
    }

    this.textBuffer += this.decoder.decode(dataView, { stream: !flushText });
    const lines = this.textBuffer.split(/\r\n|\n|\r/);
    this.textBuffer = lines.pop() || "";
    lines.forEach((line) => this.processTextReading(line));

    if (flushText && this.textBuffer.trim()) {
      this.processTextReading(this.textBuffer);
      this.textBuffer = "";
    } else if (this.textBuffer.trim() && this.textFlushTimer === null) {
      this.textFlushTimer = window.setTimeout(() => {
        this.textFlushTimer = null;
        const pendingText = this.textBuffer;
        this.textBuffer = "";
        this.processTextReading(pendingText);
      }, 50);
    }
  }

  processTextReading(value) {
    const text = value.trim().replace(',', '.');
    if (!text) return;

    // The Arduino's text protocol sends flexion progress, not degrees: "Cotovelo:XX" (0–100%).
    const elbowIntegerMatch = text.match(/^Cotovelo\s*:\s*(\d+)$/i);
    if (elbowIntegerMatch) {
      const rawPercent = Number.parseInt(elbowIntegerMatch[1], 10);
      if (rawPercent < 0 || rawPercent > 100) {
        console.warn("[BLE STREAM] Valor Cotovelo ignorado; esperava inteiro de 0 a 100:", text);
        return;
      }
      const angleDeg = this.extendedAngleDeg + ((this.flexedAngleDeg - this.extendedAngleDeg) * rawPercent) / 100;
      this.onDataCallback({
        timestamp: Date.now(),
        angleDeg: parseFloat(angleDeg.toFixed(1)),
        rawPercent,
        rawValue: text
      });
      return;
    }

    const percentMatch = text.match(/([-+]?(?:\d+\.?\d*|\.\d+))\s*%/);
    const labeledAngleMatch = text.match(/(?:^|[^A-Za-zÀ-ÿ])(?:cotovelo|ângulo|angulo|angle|flex[aã]o)[^0-9+\-]{0,32}([-+]?(?:\d+\.?\d*|\.\d+))/i);
    const numberMatch = labeledAngleMatch || text.match(/[-+]?(?:\d+\.?\d*|\.\d+)/);
    const numericValue = labeledAngleMatch
      ? Number(labeledAngleMatch[1])
      : numberMatch ? Number(numberMatch[0]) : NaN;
    const explicitlyDegrees = /(?:°|\bdeg\b|graus?|ângulo|angulo|angle)/i.test(text);
    const isPercent = percentMatch !== null || (
      this.activeProfile && this.activeProfile.format === "text" &&
      !labeledAngleMatch &&
      Number.isFinite(numericValue) && numericValue >= 0 && numericValue <= 100 &&
      !explicitlyDegrees
    );
    const rawPercent = percentMatch ? Number(percentMatch[1]) : isPercent ? numericValue : null;
    const angleDeg = rawPercent !== null
      ? this.extendedAngleDeg + ((this.flexedAngleDeg - this.extendedAngleDeg) * rawPercent) / 100
      : numericValue;

    if (!Number.isFinite(angleDeg) || angleDeg < 0 || angleDeg > 180 || (rawPercent !== null && (rawPercent < 0 || rawPercent > 100))) {
      console.warn("[BLE STREAM] Leitura ignorada; esperava ângulo identificado (0–180°) ou percentual (0–100%):", text);
      return;
    }

    this.onDataCallback({
      timestamp: Date.now(),
      angleDeg: parseFloat(angleDeg.toFixed(1)),
      ...(rawPercent !== null ? { rawPercent } : {}),
      rawValue: text
    });
  }

  handleDisconnection() {
    this.isConnected = false;
    if (this.readTimer !== null) window.clearInterval(this.readTimer);
    if (this.textFlushTimer !== null) window.clearTimeout(this.textFlushTimer);
    this.readTimer = null;
    this.textFlushTimer = null;
    this.textBuffer = "";
    this.characteristic = null;
    this.activeProfile = null;
    this.server = null;
    console.warn("[WEB BLE] Sensor Bluetooth desconectado.");
    if (this.shouldReconnect && !this.disconnectRequested) {
      this.scheduleReconnect();
    } else {
      this.onStatusCallback(false, this.device ? this.device.name || "HM-06" : "HM-06", false);
    }
  }

  async disconnect() {
    this.disconnectRequested = true;
    this.shouldReconnect = false;
    this.isReconnecting = false;
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.device && this.device.gatt && this.device.gatt.connected) {
      this.device.gatt.disconnect();
    } else {
      this.handleDisconnection();
    }
  }
}

window.LeanstarSignalFilter = LeanstarSignalFilter;
window.LeanstarAngleConverter = LeanstarAngleConverter;
window.LeanstarBLEManager = LeanstarBLEManager;
