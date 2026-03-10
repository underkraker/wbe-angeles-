# App local de WhatsApp (Dream Clean)

Esta app recibe citas desde `index.html` y las envia al WhatsApp del negocio sin usar webhook.

## 1) Instalar

```bash
cd local-whatsapp-app
npm install
```

## 2) Ejecutar

```bash
npm start
```

- Se mostrara un QR en terminal.
- Escanea el QR con tu WhatsApp (Dispositivos vinculados).
- Cuando aparezca `WhatsApp local conectado y listo`, ya funciona.

## 3) Configurar en Admin

1. Abre `admin.html`
2. En **General y Logo**:
   - `Usar app local de WhatsApp` = `Si`
   - `Endpoint app local` = `http://127.0.0.1:3010/send-booking`
3. Guarda cambios.

## Notas

- La app debe estar corriendo para que el envio automatico funcione.
- Si se cierra, las citas se siguen guardando en el panel admin, pero no se envian hasta volver a levantar la app.
