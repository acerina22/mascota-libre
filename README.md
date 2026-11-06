# Mascota Libre

Adopciones de perros y gatos, abierto a todos: publicá, adoptá, sumate como refugio o como hogar de tránsito.

## Qué hace

- **Registro e ingreso** con email y contraseña.
- **Dar en adopción**: flyer con foto, nombre, tipo (perro/gato), sexo, edad, tamaño, raza, zona y salud.
- **Adoptar**: explorar con filtros y mandar una solicitud con mensaje y contacto.
- **Mi panel**: ver y responder las solicitudes recibidas, marcar adoptado, seguir las solicitudes enviadas.
- **Refugios** y **Tránsitos**: directorios donde cualquiera se anota desde su perfil.
- **Flyer descargable** (1080×1350) para compartir en redes.

## Cómo está armado

- **Neon**: base de datos Postgres, registro de usuarios (Neon Auth), fotos y acceso desde la página (Data API). Esquema y reglas de seguridad en `db/schema.sql`.
- Las fotos se comprimen en el navegador y se guardan en la base: una miniatura para las listas y una grande para la ficha.
- La página es estática (HTML + CSS + JS, sin compilación). Datos de conexión en `config.js`.

## Publicar

1. Subir la carpeta como sitio estático (Render, Netlify, GitHub Pages…).
2. Agregar la dirección del sitio como dominio de confianza en Neon Auth.
