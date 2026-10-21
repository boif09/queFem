# Guía de Play Console para Tens pla?

Respuestas propuestas para los formularios de Play Console, basadas en lo que hace la app a 2026-10-21 (TWA de
`https://tenspla.cat`, sin cuentas, sin anuncios, con Umami y enlaces de afiliado de Fever). Si la app cambia
(por ejemplo, notificaciones o ubicación), hay que revisar estas respuestas. Los textos de la ficha están en
[`google-play.md`](google-play.md) y la compilación en [`../android/README.md`](../android/README.md).

## Antes de empezar: bloqueante legal

Google exige una política de privacidad accesible y **exacta**. Hoy los textos legales contradicen lo que hace
la app, y hay que corregirlos en CA/ES/EN (y mencionar la app de Android) antes de enviarla a revisión:

- `https://tenspla.cat/privacitat` no menciona Umami, y la página de almacenamiento dice que Tens pla? no usa
  analítica, aunque Umami (sin cookies) registra visitas y algunos eventos (`docs/ANALYTICS.md`).
- El aviso legal dice que Tens pla? «actualment no monetitzada» y que no incorpora «afiliació», pero las fichas
  de Fever llevan enlaces de afiliado y la ficha de la tienda lo declara.

Es una decisión legal del propietario; conviene revisarla con un gestor.

## 1. Crear la app

- Nombre: `Tens pla? Plans a Catalunya` · Idioma predeterminado: catalán (`ca`).
- App o juego: **App** · Gratuita o de pago: **Gratuita** (no se puede cambiar a de pago después).
- Aceptar las declaraciones (políticas del programa y leyes de exportación de EE. UU.).

## 2. Configurar la app (panel «Configura tu aplicación»)

| Sección | Respuesta |
| --- | --- |
| Política de privacidad | `https://tenspla.cat/privacitat` (tras corregirla, ver arriba) |
| Acceso a la aplicación | Toda la funcionalidad está disponible sin restricciones (no hay inicio de sesión) |
| Anuncios | **No**, la app no contiene anuncios. Los enlaces de compra de entradas de Fever son enlaces de afiliado dentro del contenido, no anuncios de terceros ni un SDK publicitario |
| Clasificación de contenido | Ver el apartado 3 |
| Público objetivo | **18 años o más**. Marcar menores de 13 obligaría a cumplir la política de Familias; aunque haya planes familiares, la app no está diseñada para niños |
| App de noticias | **No** |
| Apps relacionadas con la COVID-19 | No |
| Seguridad de los datos | Ver el apartado 4 |
| Apps gubernamentales | **No** (no es un servicio oficial de la Generalitat) |
| Funciones financieras | Ninguna |
| Salud | Ninguna |
| Categoría y contacto | Categoría **Eventos**; correo `contacte@tenspla.cat`; web `https://tenspla.cat` |

## 3. Clasificación de contenido (cuestionario IARC)

- Correo: `contacte@tenspla.cat` · Categoría: **«Todas las demás categorías de aplicaciones»** (no es un juego).
- Violencia, sexo, lenguaje malsonante, drogas, apuestas: **No**.
- Interacción entre usuarios (chat, contenido generado por usuarios): **No**.
- Comparte la ubicación del usuario con otros: **No**.
- Compras digitales dentro de la app: **No** (las entradas se compran en la web de Fever, fuera de la app).
- Referencias a alcohol o tabaco: los planes vienen de agendas oficiales y algunos son tastos de vi, fires de la
  cervesa o similares. Responder con honestidad; si el cuestionario pregunta por referencias o promoción de
  alcohol en el contenido, la respuesta prudente es **Sí, referencias**, lo que puede subir la edad recomendada
  (por ejemplo, PEGI 12). Es preferible a una clasificación que Google corrija después.

## 4. Seguridad de los datos

Se declaran los datos que recoge la app, incluidos los que recoge la web que muestra.

- ¿Recoge o comparte datos de usuario? **Sí** (estadística propia).
- ¿Están todos los datos cifrados en tránsito? **Sí** (HTTPS).
- ¿Ofreces una forma de solicitar la eliminación de datos? Los datos de Umami no van asociados a ninguna
  persona ni identificador; los favoritos están solo en el móvil y se borran desde la app. Si el formulario lo
  exige, indicar el correo `contacte@tenspla.cat`.

Tipos de datos:

| Tipo | Recogido | Compartido | Uso | Obligatorio |
| --- | --- | --- | --- | --- |
| Actividad en la app → **Interacciones con la app** (páginas vistas, clics en entradas, favoritos, compartir) | Sí | No | Analíticas | Sí (automático) |

No se declaran: ubicación (no se pide la ubicación del dispositivo), información personal, contactos, fotos,
identificadores del dispositivo ni información financiera. Los favoritos se guardan solo en el dispositivo y
Google no considera «recogidos» los datos que no salen de él.

A revisar al rellenar el formulario: los registros técnicos de Nginx guardan la dirección IP y el User-Agent de
cada petición (aviso de privacidad, apartado de registros) y Umami recibe los eventos en `stats.tenspla.cat`.
Google pide declarar lo que sale del dispositivo, también desde el contenido web de la app
([guía oficial](https://support.google.com/googleplay/android-developer/answer/10787469)). Comprobar en ese
momento cómo clasifica Google los registros de servidor usados solo para seguridad y prevención de fraude y, si
los considera recogidos, declararlos con ese fin.

## 5. Prueba cerrada (obligatoria en cuentas personales nuevas)

1. *Prueba y publica → Pruebas → Prueba cerrada* → crear un canal (p. ej. «Testers»).
2. Testers: añadir un **grupo de Google** con al menos 12 personas (mejor 14–15) que tengan Android y cuenta de
   Google.
3. Subir el `.aab` firmado (ver `../android/README.md`), escribir las notas de la versión y enviarla a revisión.
4. Cuando Google la apruebe, compartir el enlace de suscripción a la prueba con los testers: cada uno debe
   aceptar e instalar la app desde Google Play, y seguir apuntado **14 días seguidos**.
5. Tras subir el primer `.aab`, copiar la huella SHA-256 de *Integridad de la aplicación → Firma de aplicaciones*
   y publicar `/.well-known/assetlinks.json` en tenspla.cat (ver `../android/README.md`), para que la app se vea
   sin barra de dirección.
6. Pasados los 14 días, solicitar el acceso a producción desde el panel (Google pregunta cómo fue la prueba).

## 6. Ficha de Play Store

Copiar los textos de [`google-play.md`](google-play.md) y subir de [`images/`](images/):

- Icono: `icon-512.png` (512×512, PNG de 32 bits).
- Imagen destacada: `feature-graphic-1024x500.png`.
- Capturas de teléfono: las cinco de `phone/` (1080×1920). Las de `screenshots/` (1080×2160, sin titular) son
  las capturas originales, por si se prefieren sin texto.

Las imágenes con titular están en catalán. Para las fichas en castellano e inglés se pueden reutilizar o
generar otras cambiando el idioma en `capture-screenshots.mjs` y los titulares en `render-graphics.mjs`.
