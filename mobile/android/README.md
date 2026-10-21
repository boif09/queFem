# App Android de Tens pla? (TWA)

App de Google Play `cat.tenspla.app`: una Trusted Web Activity que abre `https://tenspla.cat` a pantalla completa
dentro de Chrome. No contiene una copia de la web: cada cambio desplegado en tenspla.cat llega a la app sin
publicar una versión nueva. Solo hay que publicar otra versión si cambia algo de este proyecto (nombre, icono,
colores, permisos, versión de Android).

- `twa-manifest.json`: configuración de la app (fuente de verdad).
- `app/`, `gradle/`, `build.gradle`…: proyecto Android generado con `@bubblewrap/core` 1.25.0 a partir del
  manifiesto. Para regenerarlo tras cambiar el manifiesto, ver `generate-project.cjs`.
- La clave de firma **no** está en el repositorio y nunca debe estarlo (`.gitignore` la excluye).

Requisitos en este equipo: Android Studio (aporta el SDK y el JDK 21 en
`C:\Program Files\Android\Android Studio\jbr`). Mínimo Android 7.0 (API 24); se compila para Android 16 (API 36),
lo que exige Google Play desde agosto de 2026.

## 1. Crear la clave de subida (una sola vez)

La crea el propietario, porque elige la contraseña. Guardar el archivo y la contraseña en un lugar seguro y con
copia (por ejemplo, el gestor de contraseñas); sin ellos no se pueden publicar actualizaciones hasta pedir a Google
que cambie la clave.

```powershell
New-Item -ItemType Directory -Force "C:\Users\xavid\Documents\Casa - Judit y Xavi\TensPla-claves"
& "C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe" -genkeypair -v -keystore "C:\Users\xavid\Documents\Casa - Judit y Xavi\TensPla-claves\tenspla-upload.keystore" -alias tenspla-upload -keyalg RSA -keysize 2048 -validity 10000
```

`keytool` pide la contraseña y unos datos (nombre, organización, país…), que no se publican.

Con **Firma de aplicaciones de Play** (activada por defecto en apps nuevas) Google guarda la clave definitiva de la
app; esta es solo la «clave de subida» con la que se firman los archivos que se suben.

## 2. Compilar el archivo para Google Play (.aab)

```powershell
cd "C:\Users\xavid\Documents\Casa - Judit y Xavi\queFem\mobile\android"
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
.\gradlew.bat bundleRelease
& "$env:JAVA_HOME\bin\jarsigner.exe" -keystore "C:\Users\xavid\Documents\Casa - Judit y Xavi\TensPla-claves\tenspla-upload.keystore" app\build\outputs\bundle\release\app-release.aab tenspla-upload
```

`jarsigner` pide la contraseña de la clave. El resultado firmado es
`app\build\outputs\bundle\release\app-release.aab`, que es lo que se sube a Play Console.

Para cada versión nueva, subir antes `appVersionCode` (y `appVersion`) en `twa-manifest.json`, regenerar el
proyecto y volver a compilar: Google rechaza un `versionCode` repetido.

## 3. Vincular la app con la web (`assetlinks.json`)

Para que la app se abra sin barra de navegador, `https://tenspla.cat/.well-known/assetlinks.json` debe declarar
la huella SHA-256 de la clave con la que Google firma la app. Se obtiene **después de subir el primer .aab**:
Play Console → la app → *Prueba y publica → Configuración → Integridad de la aplicación → Firma de aplicaciones*
→ «Huella digital del certificado SHA-256». Con esa huella (y, si se quiere probar la versión instalada desde el
.aab firmado localmente, también la de la clave de subida), el archivo es:

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "cat.tenspla.app",
      "sha256_cert_fingerprints": ["AA:BB:…:FF"]
    }
  }
]
```

Se guarda en `frontend/public/.well-known/assetlinks.json` y se despliega con la web; Nginx ya lo sirve como
`application/json` (hoy esa ruta cae en el fallback de la SPA). Huella de la clave de subida:

```powershell
& "C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe" -list -v -keystore "C:\Users\xavid\Documents\Casa - Judit y Xavi\TensPla-claves\tenspla-upload.keystore" -alias tenspla-upload
```

Mientras no esté publicado el archivo, la app funciona igual pero muestra una barra con la dirección de la web.

## 4. Probar en un emulador o móvil

```powershell
.\gradlew.bat assembleDebug
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" install -r app\build\outputs\apk\debug\app-debug.apk
```

La versión de depuración se firma con la clave de depuración de Android Studio, así que siempre muestra la barra
de dirección (su huella no está en `assetlinks.json`). Comprobado el 2026-10-21 en el emulador de Android 16 de
Android Studio: la app se instala, abre Chrome y carga `https://tenspla.cat/`.
