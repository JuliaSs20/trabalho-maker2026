#include <SoftwareSerial.h>

// Pinos 3 (RX) e 2 (TX) para o módulo Bluetooth.
SoftwareSerial meuBluetooth(3, 2);

const int pinoSensor = A0;

// Calibração do cotovelo: ajuste conforme as leituras do seu sensor.
const int VALOR_RETO = 300;
const int VALOR_DOBRADO = 850;

float valorSuavizado = 0;

void setup() {
  Serial.begin(9600);
  meuBluetooth.begin(9600);

  const int leituraInicial = analogRead(pinoSensor);
  int porcentagemInicial = map(leituraInicial, VALOR_RETO, VALOR_DOBRADO, 0, 100);
  porcentagemInicial = constrain(porcentagemInicial, 0, 100);
  // Inicializa o filtro na mesma escala percentual usada no loop.
  valorSuavizado = porcentagemInicial;
  Serial.println("Sistema Cotovelo e Bluetooth Iniciado!");
}

void loop() {
  const int valorBruto = analogRead(pinoSensor);

  int porcentagemAlvo = map(valorBruto, VALOR_RETO, VALOR_DOBRADO, 0, 100);
  porcentagemAlvo = constrain(porcentagemAlvo, 0, 100);

  // Resposta rápida ao dobrar e amortecida ao esticar.
  if (porcentagemAlvo > valorSuavizado) {
    valorSuavizado += (porcentagemAlvo - valorSuavizado) * 0.5;
  } else {
    valorSuavizado += (porcentagemAlvo - valorSuavizado) * 0.04;
  }

  const int valorFinal = (int)valorSuavizado;

  Serial.print("Bruto: ");
  Serial.print(valorBruto);
  Serial.print(" | Cotovelo: ");
  Serial.print(valorFinal);
  Serial.println("%");

  // O site recebe este percentual e o converte para 0°–45°.
  meuBluetooth.print("Cotovelo:");
  meuBluetooth.println(valorFinal);

  delay(80);
}
