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
 * Calibração da leitura analógica do sensor para um ângulo de 0° a 90°.
 */
class LeanstarAngleConverter {
  constructor() {
    // Calibre estes valores conforme as leituras reais do sensor (ADC 0–1023).
    this.sensorStraight = 300; // Braço estendido = 0° (VALOR_RETO do firmware)
    this.sensorBent = 850;     // Cotovelo flexionado = 90° (VALOR_DOBRADO do firmware)
    // Um pouco mais responsivo, preservando suavização contra ruído do sensor.
    this.filter = new LeanstarSignalFilter(4, 0.5);
    this.lastFilteredValue = this.sensorStraight;
  }

  /**
   * Calibra o valor analógico do braço estendido (0°).
   * @param {number} currentValue Leitura ADC com o braço estendido.
   */
  calibrateExtension(currentValue = this.lastFilteredValue) {
    this.sensorStraight = currentValue;
    console.info(`[CALIBRAÇÃO] Braço estendido: ${currentValue}`);
    return this.sensorStraight;
  }

  /**
   * Calibra o valor analógico do cotovelo flexionado (90°).
   * @param {number} currentValue Leitura ADC com o cotovelo flexionado.
   */
  calibrateFlexion(currentValue = this.lastFilteredValue) {
    if (Math.abs(currentValue - this.sensorStraight) < 5) {
      console.warn("[CALIBRAÇÃO] Variação insuficiente no sensor.");
      return this.sensorBent;
    }
    this.sensorBent = currentValue;
    console.info(`[CALIBRAÇÃO] Cotovelo flexionado: ${currentValue}`);
    return this.sensorBent;
  }

  /**
   * Converte uma leitura analógica (0–1023) para um ângulo estimado (0–90°).
   */
  rawValueToAngle(rawValue) {
    const cleanValue = this.filter.process(rawValue);
    this.lastFilteredValue = cleanValue;
    const difference = this.sensorBent - this.sensorStraight;
    if (Math.abs(difference) < 1) return NaN;
    const progress = (cleanValue - this.sensorStraight) / difference;
    const angleDeg = Math.max(0, Math.min(90, progress * 90));
    return Number(angleDeg.toFixed(1));
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
        // The firmware packet contains a 12-bit ADC reading; normalize it to
        // the 10-bit 0–1023 scale used by the text protocol and calibration.
        const rawSensorValue = Math.round((rawAdc / 4095) * 1023);
        const angleDeg = this.angleConverter.rawValueToAngle(rawSensorValue);
        this.onDataCallback({
          timestamp: Date.now(),
          angleDeg,
          rawSensorValue,
          rawValue: String(rawSensorValue),
          rawAdc,
          voltage,
          resistanceOhms,
          targetJointName: "Ângulo do Cotovelo"
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

    // O Arduino transmite a leitura ADC de 10 bits no formato FLEX:valor.
    const flexMatch = text.match(/^FLEX\s*:\s*(\d+)$/i);
    if (flexMatch) {
      const rawValue = Number.parseInt(flexMatch[1], 10);
      if (!Number.isInteger(rawValue) || rawValue < 0 || rawValue > 1023) {
        console.warn("[BLE STREAM] Leitura FLEX inválida; esperava valor de 0 a 1023:", text);
        return;
      }

      const angleDeg = this.angleConverter.rawValueToAngle(rawValue);
      if (!Number.isFinite(angleDeg)) {
        console.warn("[BLE STREAM] Não foi possível calcular o ângulo.", text);
        return;
      }

      this.onDataCallback({
        timestamp: Date.now(),
        angleDeg,
        rawSensorValue: rawValue,
        rawValue: text,
        targetJointName: "Ângulo do Cotovelo"
      });
      return;
    }

    // Compatibilidade com o firmware atual, que transmite percentual como
    // Cotovelo:XX ou C:XX (0% estendido, 100% flexionado).
    const elbowIntegerMatch = text.match(/^(?:Cotovelo|C)\s*:\s*(\d+)$/i);
    if (elbowIntegerMatch) {
      const rawPercent = Number.parseInt(elbowIntegerMatch[1], 10);
      if (rawPercent < 0 || rawPercent > 100) {
        console.warn("[BLE STREAM] Percentual de flexão inválido; esperava 0 a 100:", text);
        return;
      }
      this.onDataCallback({
        timestamp: Date.now(),
        angleDeg: Number(((rawPercent * 90) / 100).toFixed(1)),
        rawPercent,
        rawValue: text,
        targetJointName: "Ângulo do Cotovelo"
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
      ? (rawPercent * 90) / 100
      : numericValue;

    if (!Number.isFinite(angleDeg) || angleDeg < 0 || angleDeg > 90 || (rawPercent !== null && (rawPercent < 0 || rawPercent > 100))) {
      console.warn("[BLE STREAM] Leitura ignorada; esperava ângulo identificado (0–90°) ou percentual (0–100%):", text);
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
