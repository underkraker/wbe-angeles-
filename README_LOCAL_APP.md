# Dream Clean - App local (logica tipo GS)

Este proyecto ahora usa una logica parecida a `gs_car`:

- Backend Node + Express + SQLite
- Estado central (config, paquetes, promociones, citas)
- Envio de citas a WhatsApp del negocio via `whatsapp-web.js`
- Panel admin y web publica consumiendo el mismo estado

## 1) Instalar dependencias

```bash
npm install
```

## 2) Levantar app

```bash
npm start
```

Abre:

- Sitio: `http://127.0.0.1:3000/index.html`
- Admin: `http://127.0.0.1:3000/admin.html`

## 3) Vincular WhatsApp

Al iniciar el server, se imprime un QR en terminal.
Escanealo desde WhatsApp > Dispositivos vinculados.

Cuando quede conectado, las nuevas citas se envian al numero del negocio configurado en Admin.

## 4) Clave admin

- Por defecto: `dreamclean2026`
- Puedes cambiarla con variable de entorno:

```bash
ADMIN_PASSWORD="tu_clave" npm start
```
