#include <SoftwareSerial.h>
#include <Servo.h>

// Bluetooth: RX no pino 3, TX no pino 2
SoftwareSerial meuBluetooth(3, 2);

// Servo para replicar o movimento do cotovelo
Servo motorCotovelo;

// Definição dos pinos
const int pinoSensor = A0;
const int pinoServo = 9;
const int ledEsticado = 5;
const int ledDobrado = 6;

// Calibração do sensor: ajuste conforme os testes físicos
const int VALOR_RETO = 300;
const int VALOR_DOBRADO = 850;

// Variáveis de controle
float valorSuavizado = 0;
unsigned long ultimoTempo = 0;
const int intervaloEnvio = 50;

void setup() {
  Serial.begin(9600);
  meuBluetooth.begin(9600);

  motorCotovelo.attach(pinoServo);
  pinMode(ledEsticado, OUTPUT);
  pinMode(ledDobrado, OUTPUT);

  valorSuavizado = analogRead(pinoSensor);
  int porcentagemInicial = map((int)valorSuavizado, VALOR_RETO, VALOR_DOBRADO, 0, 100);
  valorSuavizado = constrain(porcentagemInicial, 0, 100);

  Serial.println("Sistema Cotovelo Atuado Iniciado!");
}

void loop() {
  // Lê e converte a posição do sensor em percentual de flexão.
  int valorBruto = analogRead(pinoSensor);
  int porcentagemAlvo = map(valorBruto, VALOR_RETO, VALOR_DOBRADO, 0, 100);
  porcentagemAlvo = constrain(porcentagemAlvo, 0, 100);

  // Filtro adaptativo para suavizar o movimento.
  if (porcentagemAlvo > valorSuavizado) {
    valorSuavizado += (porcentagemAlvo - valorSuavizado) * 0.4;
  } else {
    valorSuavizado += (porcentagemAlvo - valorSuavizado) * 0.08;
  }

  int valorFinal = (int)valorSuavizado;

  // Move o servo de 0 a 180 graus conforme a flexão.
  int anguloServo = map(valorFinal, 0, 100, 0, 180);
  motorCotovelo.write(anguloServo);

  // LEDs de feedback visual.
  if (valorFinal < 30) {
    digitalWrite(ledEsticado, HIGH);
    digitalWrite(ledDobrado, LOW);
  } else if (valorFinal > 70) {
    digitalWrite(ledEsticado, LOW);
    digitalWrite(ledDobrado, HIGH);
  } else {
    digitalWrite(ledEsticado, HIGH);
    digitalWrite(ledDobrado, HIGH);
  }

  // Envia os dados sem bloquear o loop.
  if (millis() - ultimoTempo >= intervaloEnvio) {
    ultimoTempo = millis();

    Serial.print("Bruto: ");
    Serial.print(valorBruto);
    Serial.print(" | Cotovelo: ");
    Serial.print(valorFinal);
    Serial.print("% | Motor: ");
    Serial.print(anguloServo);
    Serial.println(" deg");

    // O site recebe o percentual no formato C:NN.
    meuBluetooth.print("C:");
    meuBluetooth.println(valorFinal);
  }
}
