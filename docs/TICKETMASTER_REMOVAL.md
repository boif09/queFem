# Retirada operativa de contenido Ticketmaster

Este procedimiento permite retirar una procedencia concreta de Ticketmaster sin modificar las demás fuentes de un plan. El objetivo operativo es atender las solicitudes válidas en menos de 24 horas.

Canal público de contacto: `contacte@jusboif.es`

No deben copiarse a este documento el nombre, email ni otros datos personales de quien solicite una retirada. El registro interno debe limitarse a la referencia de la solicitud, el Ticketmaster event ID, las fechas y el resultado técnico.

## 1. Localizar el event ID

Usar el identificador oficial del evento recibido en la solicitud o extraído de su procedencia en Què Fem?. El comando acepta exclusivamente el Ticketmaster event ID; no acepta un ID interno de `plans`, un título ni una URL.

## 2. Comprobar sin escrituras

Desde la raíz del proyecto y con `DATABASE_PATH` apuntando a la base correcta:

```bash
npm run ticketmaster:remove -- EVENT_ID --dry-run
```

Revisar el plan encontrado, todas sus procedencias y si quedaría activo o `inactive`. Un ID inexistente termina sin modificar SQLite.

Para una solicitud expresa que requiera eliminación física inmediata si el plan es exclusivamente Ticketmaster, usar el dry-run explícito:

```bash
npm run ticketmaster:remove -- EVENT_ID --purge --dry-run
```

El resultado indica si el plan se conservaría por tener otras fuentes o si se eliminaría físicamente.

## 3. Hacer backup en producción

Antes de retirar contenido, crear y verificar una copia consistente de SQLite según el procedimiento operativo del servidor. No copiar únicamente el fichero principal mientras existan escrituras WAL activas. Puede utilizarse el comando de backup de SQLite disponible en producción o detener de forma controlada las escrituras durante la copia.

Registrar internamente la ruta y hora del backup, sin incluir datos personales de quien realizó la solicitud.

## 4. Ejecutar la retirada

Solo después de validar el dry-run:

```bash
npm run ticketmaster:remove -- EVENT_ID
```

Para una solicitud expresa aprobada, ejecutar la eliminación física inmediata del plan huérfano con:

```bash
npm run ticketmaster:remove -- EVENT_ID --purge
```

La operación se ejecuta dentro de una transacción:

- elimina únicamente el `plan_sources` de Ticketmaster cuyo `source_record_id` coincide;
- si quedan procedencias, por ejemplo Gencat, conserva el plan activo y no modifica esas procedencias;
- sin `--purge`, si no queda ninguna procedencia, marca el plan como `inactive` siguiendo la misma lógica de reconciliation;
- registra `inactive_at` cuando el plan pierde su última procedencia;
- con `--purge`, vuelve a comprobar dentro de la misma transacción que no queda ninguna procedencia, elimina sus `plan_categories` y después el plan;
- con `--purge`, si queda Gencat u otra procedencia, conserva el plan y elimina exclusivamente Ticketmaster;
- nunca elimina categorías compartidas, fuentes, `import_runs` ni otros planes.

Repetir el comando con el mismo ID es seguro: informará de que ya no existe esa procedencia y no escribirá nada.

### Diferencia entre desaparición normal y solicitud expresa

Una desaparición normal de un feed completo válido elimina la procedencia Ticketmaster, deja un plan sin fuentes como `inactive` y permite su purga física automática después de 7 días mediante `npm run purge:inactive`. Los 7 días son una política interna de minimización y operación, no un plazo legal.

Una solicitud expresa no espera esos 7 días: se revisa, se valida primero con `--purge --dry-run` y, cuando corresponda, se ejecuta con `--purge`, con objetivo operativo inferior a 24 horas. El comando elimina inmediatamente la procedencia y su payload Ticketmaster. Si no quedan fuentes, elimina físicamente el plan; si quedan otras fuentes, las conserva junto con el plan.

`--purge` no debe utilizarse para desapariciones ordinarias del feed. Repetirlo sobre un event ID ya retirado o purgado es seguro: informa de que no existe y no modifica otros datos.

## 5. Verificar

Comprobar la API usando el ID interno mostrado por el comando:

```bash
curl -i https://quefem.jusboif.es/api/plans/PLAN_ID
```

- Un plan exclusivamente Ticketmaster debe dejar de exponerse porque queda `inactive`.
- Un plan compartido debe seguir disponible y su respuesta no debe incluir la procedencia Ticketmaster retirada.

Después, abrir la ficha o repetir su búsqueda en el frontend y verificar el mismo resultado. Si existe una capa de caché futura, invalidarla conforme a su runbook; actualmente no hay ninguna documentada.

## 6. Cerrar la actuación

Registrar internamente, sin datos personales del solicitante:

- referencia interna de la solicitud;
- Ticketmaster event ID;
- hora de recepción, dry-run, backup, retirada y verificación;
- resultado: plan conservado por otra fuente o plan marcado `inactive`;
- persona operadora o identificador interno de guardia, según la política de acceso del proyecto.

Si el comando falla o los datos no coinciden con la solicitud, no manipular SQLite manualmente sin una segunda revisión técnica.
