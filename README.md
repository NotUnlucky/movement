# Cartada Royale

Jogo multiplayer 2D em navegador (Chrome recomendado), com salas de ate 6 jogadores.

## Tecnologias

- Node.js + Express
- Socket.IO (tempo real)
- Canvas 2D (cliente)

## Requisitos

- Node.js 18+

## Rodar local

```bash
npm install
npm start
```

Abra `http://localhost:3000` no Chrome.

## Deploy no Render

Opcao recomendada (Blueprint):

1. No Render, clique em **New +** -> **Blueprint**.
2. Selecione este repositorio.
3. O arquivo `render.yaml` ja cria o servico com:
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Health Check: `/healthz`

Opcao manual (Web Service):

1. Crie um **Web Service** apontando para este repositorio.
2. Configure:
   - Runtime: `Node`
   - Build Command: `npm install`
   - Start Command: `npm start`
3. O servidor usa `PORT` automaticamente no Render.

## Controles

Desktop:
- `WASD`/setas: mover
- `Shift`: deslizar
- `Space`: pular
- Mouse: mirar
- Clique nas cartas ou teclas `1`, `2`, `3`: usar carta

Mobile:
- D-pad na tela para mover
- Botao `Pular`
- Botao `Deslizar`
- Toque nas cartas para usar

No mobile, o jogo foi feito para funcionar apenas em paisagem (horizontal).
