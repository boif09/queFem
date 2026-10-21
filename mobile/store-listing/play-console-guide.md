# Guía de Play Console para Tens pla?

Respuestas dadas en los formularios de Play Console el 2026-10-21 (primer envío a revisión), basadas en lo que hace la app ese día (TWA de
`https://tenspla.cat`, sin cuentas, sin anuncios, con Umami y enlaces de afiliado de Fever). Si la app cambia
(por ejemplo, notificaciones o ubicación), hay que revisar estas respuestas. Los textos de la ficha están en
[`google-play.md`](google-play.md) y la compilación en [`../android/README.md`](../android/README.md).

## Textos legales

Google exige una política de privacidad accesible y **exacta**. Los textos legales se corrigieron el 2026-10-21
(Umami, enlaces de afiliado de Fever/Impact, app de Android, conservación de 24 meses) y se desplegaron ese
mismo día, con la conservación ya programada en el servidor (`docs/DEPLOYMENT.md`).

Sigue abierto, para consultar con un gestor: con ingresos de afiliación, el art. 10 de la LSSI probablemente
exige que el aviso legal incluya el NIF y un domicilio del titular, que hoy no figuran.

## 1. Crear la app

- Nombre: `Tens pla? Plans a Catalunya` · Nombre del paquete: `cat.tenspla.app` (no se puede cambiar) ·
  Idioma predeterminado: catalán (`ca`).
- App o juego: **App** · Gratuita o de pago: **Gratuita** (no se puede cambiar a de pago después).
- Aceptar las declaraciones: políticas del programa, términos de la Firma de aplicaciones de Play y leyes de
  exportación de EE. UU. (la app solo usa el cifrado estándar de HTTPS).
- Tras crearla, la versión 1 (1.0.0) se subió primero a la **prueba interna** (solo el propietario).

## 2. Configurar la app («Termina de configurar tu aplicación»)

Respuestas enviadas el 2026-10-21 (con la primera revisión de Google):

| Sección | Respuesta |
| --- | --- |
| Política de privacidad | `https://tenspla.cat/privacitat` |
| Datos de inicio de sesión (antes «Acceso a la aplicación») | **No**: ninguna parte está restringida, no hay inicio de sesión ni contenido de pago |
| Anuncios | **No**. Los botones de entradas de Fever son enlaces de afiliado dentro del contenido, no anuncios de terceros ni un SDK publicitario |
| ID de publicidad (Android 13+) | **No** usa el ID de publicidad: la app no declara el permiso `AD_ID` (comprobado en el manifiesto de la versión 1) |
| Clasificación de contenido | Ver el apartado 3 |
| Audiencia objetivo | Solo **«A partir de 18 años»**, sin marcar «Restringir el acceso a menores». Incluir menores de 13 obligaría a cumplir la política de Familias; por eso Google se salta los pasos de detalles, anuncios y presencia |
| Seguridad de los datos | Ver el apartado 4 |
| Aplicaciones gubernamentales | **No** (proyecto independiente, no hecho por la Generalitat ni en su nombre) |
| Funciones financieras | Ninguna |
| Salud | Ninguna |
| Categoría | **Eventos**; etiquetas «Guía de viaje» y «Viajes y guías» (las más cercanas de la lista cerrada de Google) |
| Datos de contacto (públicos) | Correo `contacte@tenspla.cat`; web `https://tenspla.cat`; **sin teléfono** |
| Marketing externo | Activado (Google puede anunciar la app fuera de Play sin coste) |
| Declaración de recursos de IA | **No etiquetar recursos**: las capturas son reales y la imagen destacada se monta con código a partir del logo, sin generadores de imágenes |

## 3. Clasificación de contenido (cuestionario IARC)

- Correo: `contacte@tenspla.cat` · Categoría: **«Todos los demás tipos de aplicaciones»** · Términos de la IARC
  aceptados.
- Aplicación descargada (contenido clasificable dentro del paquete): **No**; el paquete solo contiene el
  envoltorio de la TWA.
- Uso compartido de contenido del usuario: **No**.
- Contenido en línea: **Sí** (los planes llegan de la web). Violencia, sexualidad, lenguaje, sustancias
  reguladas: **No**; las fichas informan de eventos, no muestran ese contenido.
- Promoción o venta de productos o actividades con restricción de edad: **No**. La pregunta es si la app «hace
  hincapié» en alcohol, tabaco, armas o apuestas; alguna cata o feria de cerveza entre cientos de planes no lo es.
- Varios: comparte ubicación con otros **No**; compra de contenido digital **No**; recompensas, criptomonedas o
  NFT **No**; navegador o motor de búsqueda **No**; principalmente informativa o educativa **Sí**.
- Resultado: **PEGI 3** (Europa), «Para todos» (ESRB), 3+ en el resto del mundo, USK 0.

## 4. Seguridad de los datos

Se declaran también los datos que recoge la web que muestra la app.

- ¿Recoge o comparte datos de usuario? **Sí** (estadística propia con Umami).
- ¿Se cifran en tránsito? **Sí** (HTTPS).
- Creación de cuentas: **«Mi aplicación no permite que los usuarios creen una cuenta»**; iniciar sesión con
  cuentas externas: **No**.
- ¿Forma de solicitar la eliminación de datos? (opcional) **No**: Google pide una página con pasos, datos y plazos;
  sin cuentas, y como Umami no guarda nada que identifique a una persona, no se creó. Si se quiere la insignia,
  hay que publicar antes una página específica (por ejemplo `/eliminar-dades`).

Tipos de datos declarados (comprobado en el servidor de Umami el 2026-10-21):

| Tipo | Se recogen | Se comparten | Temporal | Obligatorio | Uso |
| --- | --- | --- | --- | --- | --- |
| Ubicación → **Ubicación aproximada** (Umami guarda país, región y ciudad calculados a partir de la IP) | Sí | No | No | Sí | Analíticas |
| Actividad en aplicaciones → **Interacciones con la aplicación** (páginas vistas, clics en entradas, favoritos, compartir) | Sí | No | No | Sí | Analíticas |
| Actividad en aplicaciones → **Historial de búsqueda en la aplicación** (Umami guarda la URL de cada página, incluida la búsqueda, p. ej. `?q=jazz`) | Sí | No | No | Sí | Analíticas |

No se declaran: ubicación precisa (no se usa el GPS), información personal, financiera o de salud, mensajes,
fotos, audio, archivos, calendario, contactos, historial de navegación web (solo se registra lo visto dentro de
Tens pla?), información y rendimiento de la app, ni identificadores del dispositivo (Umami no lee ninguno; su
identificador de sesión es un hash que cambia cada mes). Hetzner aloja Umami como encargado, lo que no cuenta
como «compartir». Los favoritos solo están en el móvil y no se consideran recogidos.

Si la app cambia (por ejemplo, «planes cerca» con el GPS o notificaciones), hay que revisar esta declaración.

## 5. Prueba cerrada (obligatoria en cuentas personales nuevas)

Estado a 2026-10-21: canal **«Prueba cerrada - Alpha»** con la versión 1 (1.0.0) añadida desde la biblioteca
(la misma de la prueba interna), país **España** y testers gestionados por la lista de correos «tenspla
testers». Enviado a revisión junto con la ficha y los formularios.

1. Cuando Google lo apruebe, en *Prueba cerrada → Testers* copiar el **enlace de participación** y enviarlo a
   los testers: cada uno lo abre en el navegador del móvil, acepta e instala desde Google Play, y sigue apuntado
   **14 días seguidos**. Hacen falta al menos 12 (mejor 14–15).
2. Pasados los 14 días con 12 testers, solicitar el acceso a producción desde el panel (Google pregunta cómo fue
   la prueba).

La prueba interna (solo el propietario) sirvió para obtener la huella de Firma de aplicaciones de Play y
publicar `/.well-known/assetlinks.json` (ver `../android/README.md`).

## 6. Ficha de Play Store

Copiar los textos de [`google-play.md`](google-play.md) y subir de [`images/`](images/):

- Icono: `icon-512.png` (512×512, PNG de 32 bits).
- Imagen destacada: `feature-graphic-1024x500.png`.
- Capturas de teléfono: las cinco de `phone/` (1080×1920), en orden. Las de `screenshots/` (1080×2160, sin titular) son
  las capturas originales, por si se prefieren sin texto.

Las imágenes con titular están en catalán. Para las fichas en castellano e inglés se pueden reutilizar o
generar otras cambiando el idioma en `capture-screenshots.mjs` y los titulares en `render-graphics.mjs`.
