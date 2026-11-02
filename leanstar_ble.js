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
    this.voltageStraight0Deg = 2.150; // Membro esticado (0°)
    this.voltageBent90Deg    = 1.250; // Membro fletido em 90°
    this.filter = new LeanstarSignalFilter(6, 0.22);
    this.lastFilteredVoltage = 2.150;
  }

  /**
   * Calibra o ponto de extensão total (Membro esticado = 0°)
   * @param {number} currentVoltage Voltagem lida no momento da extensão
   */
  calibrateZeroDegrees(currentVoltage = this.lastFilteredVoltage) {
    this.voltageStraight0Deg = currentVoltage;
    console.info(`[CALIBRAÇÃO LEANSTAR] Ponto 0° (Esticado) salvo em: ${currentVoltage.toFixed(3)} V`);
    return this.voltageStraight0Deg;
  }

  /**
   * Calibra o ponto de flexão de referência (Membro dobrado = 90°)
   * @param {number} currentVoltage Voltagem lida no momento da flexão a 90°
   */
  calibrateNinetyDegrees(currentVoltage = this.lastFilteredVoltage) {
    // Evita divisão por zero caso o usuário clique nos dois botões na mesma posição
    if (Math.abs(currentVoltage - this.voltageStraight0Deg) < 0.02) {
      console.warn("[CALIBRAÇÃO LEANSTAR] A variação de tensão entre 0° e 90° é muito pequena! Dobre mais a fita.");
      return this.voltageBent90Deg;
    }
    this.voltageBent90Deg = currentVoltage;
    console.info(`[CALIBRAÇÃO LEANSTAR] Ponto 90° (Dobrado) salvo em: ${currentVoltage.toFixed(3)} V`);
    return this.voltageBent90Deg;
  }

  /**
   * Converte a voltagem recebida em um ângulo articular suavizado (0° a 180°)
   * Utiliza interpolação/extrapolação linear calibrada com clamping seguro.
   */
  voltageToAngle(rawVoltage) {
    // 1. Filtra o ruído analógico da fita Leanstar
    const cleanVoltage = this.filter.process(rawVoltage);
    this.lastFilteredVoltage = cleanVoltage;

    // 2. Interpolação Linear baseada nos 2 pontos de calibração (0° e 90°)
    // Equação da reta: Angle = ((V_atual - V_0) / (V_90 - V_0)) * 90.0
    const deltaVCalib = this.voltageBent90Deg - this.voltageStraight0Deg;
    if (Math.abs(deltaVCalib) < 0.001) return 0.0;

    let angleDeg = ((cleanVoltage - this.voltageStraight0Deg) / deltaVCalib) * 90.0;

    // 3. Clamping Fisiológico (Limita a leitura entre 0.0° e 180.0°)
    angleDeg = Math.max(0.0, Math.min(180.0, angleDeg));

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

      this.device.addEventListener('gattserverdisconnected', () => this.handleDisconnection());

      console.log(`[WEB BLE] Conectando ao GATT Server de ${this.device.name || "sensor selecionado"}...`);
      this.server = await this.device.gatt.connect();

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
          (event) => this.handleCharacteristicNotification(event)
        );
        await this.characteristic.startNotifications();
      } else if (!this.characteristic.properties.read) {
        throw new Error("A característica Bluetooth não permite notificações nem leitura do ângulo.");
      }

      this.isConnected = true;
      this.onStatusCallback(true, this.device.name || "HM-06");
      if (this.characteristic.properties.read) {
        this.readCurrentValue();
        this.readTimer = window.setInterval(() => {
          const notificationsStalled = Date.now() - this.lastNotificationAt > 1000;
          if (!supportsNotifications || notificationsStalled) this.readCurrentValue();
        }, 200);
      }
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
      if (this.device && this.device.gatt && this.device.gatt.connected) {
        this.device.gatt.disconnect();
      }
      throw error;
    }
  }

  handleCharacteristicNotification(event) {
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

    this.textBuffer += this.decoder.decode(dataView);
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

    const percentMatch = text.match(/([-+]?(?:\d+\.?\d*|\.\d+))\s*%/);
    const numberMatch = text.match(/[-+]?(?:\d+\.?\d*|\.\d+)/);
    const numericValue = numberMatch ? Number(numberMatch[0]) : NaN;
    const explicitlyDegrees = /(?:°|\bdeg\b|graus?|ângulo|angulo|angle)/i.test(text);
    const isPercent = percentMatch !== null || (
      this.activeProfile && this.activeProfile.format === "text" &&
      Number.isFinite(numericValue) && numericValue >= 0 && numericValue <= 100 &&
      !explicitlyDegrees
    );
    const rawPercent = percentMatch ? Number(percentMatch[1]) : isPercent ? numericValue : null;
    const angleDeg = rawPercent !== null
      ? this.extendedAngleDeg + ((this.flexedAngleDeg - this.extendedAngleDeg) * rawPercent) / 100
      : numericValue;

    if (!Number.isFinite(angleDeg) || angleDeg < 0 || angleDeg > 180 || (rawPercent !== null && (rawPercent < 0 || rawPercent > 100))) {
      console.warn("[BLE STREAM] Leitura ignorada; esperava ângulo de 0 a 180° ou percentual de 0 a 100%:", text);
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
    this.onStatusCallback(false, this.device ? this.device.name || "HM-06" : "HM-06");
    console.warn("[WEB BLE] Sensor Bluetooth desconectado.");
  }

  async disconnect() {
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
