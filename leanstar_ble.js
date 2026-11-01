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
    this.SERVICE_UUID        = "0000ffe0-0000-1000-8000-00805f9b34fb";
    this.CHARACTERISTIC_UUID = "0000ffe1-0000-1000-8000-00805f9b34fb";

    this.device = null;
    this.server = null;
    this.characteristic = null;
    this.isConnected = false;

    this.onDataCallback = onDataCallback || (() => {});
    this.onStatusCallback = onStatusCallback || (() => {});
    this.decoder = new TextDecoder('utf-8');
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
        optionalServices: [this.SERVICE_UUID]
      });

      this.device.addEventListener('gattserverdisconnected', () => this.handleDisconnection());

      console.log(`[WEB BLE] Conectando ao GATT Server de ${this.device.name || "sensor selecionado"}...`);
      this.server = await this.device.gatt.connect();

      const service = await this.server.getPrimaryService(this.SERVICE_UUID);
      this.characteristic = await service.getCharacteristic(this.CHARACTERISTIC_UUID);

      this.characteristic.addEventListener(
        'characteristicvaluechanged',
        (event) => this.handleCharacteristicNotification(event)
      );
      await this.characteristic.startNotifications();

      this.isConnected = true;
      this.onStatusCallback(true, this.device.name || "HM-06");
      console.log("[WEB BLE] Pareado com sucesso! Recebendo ângulos do sensor...");
      return true;
    } catch (error) {
      console.error("[WEB BLE] Erro ao conectar:", error);
      this.isConnected = false;
      if (this.device && this.device.gatt && this.device.gatt.connected) {
        this.device.gatt.disconnect();
      }
      throw error;
    }
  }

  handleCharacteristicNotification(event) {
    const dataView = event.target.value;
    const text = this.decoder.decode(dataView).trim().replace(',', '.');
    const match = text.match(/[-+]?(?:\d+\.?\d*|\.\d+)/);
    const angleDeg = match ? Number(match[0]) : NaN;

    if (!Number.isFinite(angleDeg) || angleDeg < 0 || angleDeg > 180) {
      console.warn("[BLE STREAM] Leitura ignorada; esperava um ângulo em texto entre 0 e 180 graus:", text);
      return;
    }

    this.onDataCallback({
      timestamp: Date.now(),
      angleDeg: parseFloat(angleDeg.toFixed(1)),
      rawValue: text
    });
  }

  handleDisconnection() {
    this.isConnected = false;
    this.characteristic = null;
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
