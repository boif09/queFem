# Reglas específicas del backend

Aplican primero las instrucciones de [`../../AGENTS.md`](../../AGENTS.md). Este archivo solo añade contexto para `backend/src/`.

- `config.js` centraliza configuración y valores seguros por defecto; no dispersar lecturas de entorno.
- Toda evolución del esquema debe ser una migración nueva en `db/migrations/`; no reescribir migraciones ya aplicadas.
- Mantener la API pública de solo lectura y conservar su formato de respuesta salvo petición explícita.
- Los importadores deben preservar procedencia y payload auditable, respetar licencia/retención y ser idempotentes.
- Las políticas específicas de una fuente deben quedar centralizadas y probadas. No relajar filtros, deduplicación o reconciliación sin una decisión explícita.
- Un modo `--dry-run` no puede escribir en SQLite ni producir otros efectos persistentes.
- No registrar secretos ni payloads que puedan contener credenciales. Las imágenes externas requieren procedencia y autorización demostrables.
- Para cambios backend, ejecutar como mínimo `npm run test:backend`; añadir las suites afectadas cuando corresponda.

Arquitectura detallada: [`../../docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md). Fuentes: [`../../docs/DATA_SOURCES.md`](../../docs/DATA_SOURCES.md).
