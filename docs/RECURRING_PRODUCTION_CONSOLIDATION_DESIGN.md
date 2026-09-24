# Disseny — Consolidació de produccions recurrents (Fase 4C.3, no implementat)

Aquest document descriu el disseny previst per a la fase 4C.3 (encara no implementada, ni autoritzada). La fase 4C.2 va lliurar únicament un detector i un fitxer de decisions de lectura; aquest document cobreix què passaria si, més endavant, s'autoritza consolidar plans ja existents que el detector classifica `SAFE_AUTOMATIC` (o que un revisor humà marca `ACCEPT` a `data-policy/recurring-production-decisions.json`).

**Cap part d'això s'executa avui.** No hi ha escriptures previstes fins que aquest disseny sigui revisat i el gate humà l'autoritzi explícitament.

## Principi rector

**Les URLs públiques existents no es poden trencar abans que existeixi una estratègia de preservació.** Consolidar 16 plans en 1 sense abans decidir què passa amb les altres 15 URLs (`/plans/1197` .. `/plans/1211`) és inacceptable — podrien estar indexades a Google o compartides externament. Aquest ordre és estricte: **1) estratègia de preservació d'URL, 2) consolidació.** Mai a l'inrevés.

## 1. Selecció del plan canònic

Regla proposada: el plan amb l'**ID numèric més baix** del grup esdevé el canònic. És determinista, estable i normalment coincideix amb el primer plan importat (la primera ocurrència coneguda de la producció). No es proposa "el més complet" ni cap heurística de qualitat, per mantenir la selecció simple i predictible.

## 2. Preservació dels IDs públics existents

Cap plan ID que hagi estat mai públic es reutilitza ni s'elimina. Els 15 plans no supervivents d'un grup de 16 **mai s'esborren** — es converteixen en registres d'àlies/redirecció permanents (vegeu §3). Aquesta és la raó per la qual la consolidació no pot passar sense l'estratègia de redirecció ja construïda: eliminar la fila és l'única manera "neta" d'evitar duplicats a `/api/plans`, però trencaria qualsevol URL indexada.

## 3. Mecanisme de redirecció/àlies (encara no dissenyat en detall d'implementació)

Calen, com a mínim:
- Una taula nova (p. ex. `plan_aliases`) que mapegi `old_plan_id -> canonical_plan_id`, consultada pel middleware de rutes abans de retornar 404.
- Redirecció HTTP 301 permanent des de `/plans/:oldId` cap a `/plans/:canonicalId`.
- El mateix per a `/api/plans/:oldId`? A decidir — probablement també 301, o una resposta JSON amb `canonicalId` perquè els consumidors de l'API no depenguin de seguir redireccions HTTP silenciosament.
- El sitemap ha de deixar d'incloure els IDs no canònics (ja ho farà automàticament si aquests plans deixen d'aparèixer a la consulta de visibilitat pública normal).

## 4. Reenllaç de `plan_sources`

Mateix patró que ja fa `DibaImporter` amb `targetPlanId`/`preserveExistingPlan` (`backend/src/diba/dibaImporter.js`): cada `plan_sources` row dels 15 plans no supervivents es reassigna (`UPDATE plan_sources SET plan_id = ?`) al plan canònic. La procedència (source, `source_record_id`, `source_payload_json`) es conserva íntegrament — no es perd cap dada d'atribució ni de codi Gencat.

## 5. Creació de `plan_occurrences`

Infraestructura ja existent i provada en producció per a Fever (103.036 files, confirmat a la Fase 4C). Per cada `plan_sources` reenllaçat, es crea una fila `plan_occurrences` amb la data/hora d'aquell registre. No calen canvis d'esquema — només un backfill que reutilitza exactament el mateix repositori que Fever ja fa servir avui (`PlanOccurrenceRepository`).

## 6. Atribució de font

Es conserva sense canvis: cada `plan_sources` row manté el seu propi `source_record_id` i payload originals. El plan canònic mostra l'atribució agregada de totes les seves fonts, tal com ja passa avui per a qualsevol plan amb múltiples `plan_sources`.

## 7. Selecció d'imatge

`attachImages` (ja existent a `planQuery.repository.js`) ja gestiona correctament múltiples `plan_source_images` per plan amb un ordre determinista (`ROW_NUMBER() ... ORDER BY ...`). Un cop reenllaçats els `plan_sources`, el plan canònic tindrà 16 conjunts d'imatges candidates i la lògica existent ja en triaria una sense canvis addicionals.

## 8. Comportament SEO canònic

- El plan canònic esdevé l'única entrada indexable per a aquesta producció.
- Cal decidir si la data mostrada al `<title>`/meta description és "la propera ocurrència" (patró ja usat per `nextOccurrence`) en lloc d'una data fixa.
- Google pot trigar a re-indexar; els 301 permanents són el mecanisme estàndard perquè transfereixi autoritat/ranking cap a la URL canònica en lloc de mostrar un 404.
- **No s'ha d'implementar cap d'això sense revisió SEO explícita** — fora d'abast d'aquesta fase.

## 9. Rollback

Com que cap fila s'elimina mai (§2), el rollback és senzim en principi: desfer el reenllaç de `plan_sources` (tornar-los al seu `plan_id` original, registrat abans de l'operació), esborrar les files `plan_occurrences` creades en aquesta operació concreta, i esborrar les entrades de `plan_aliases` creades. Es recomana, seguint el patró ja establert a aquest projecte (Fase 4B.4), que qualsevol script d'aplicació futur:
- prengui una còpia de seguretat abans d'escriure;
- generi un fitxer SQL de rollback exacte abans de confirmar (mateix patró que `scripts/backfill-gencat-free-status.js`);
- verifiqui invariants dins d'una única transacció abans de confirmar.

## Resum de l'ordre d'implementació recomanat (Fase 4C.3+, no autoritzat encara)

1. Disseny detallat i implementació de `plan_aliases` + redirecció 301.
2. Verificació que el sitemap/SEO gestiona correctament la desaparició dels IDs no canònics.
3. Script d'aplicació bounded (patró Fase 4B.4): backup, dry-run fresc dins la transacció, verificació d'invariants, log + rollback SQL generats abans de confirmar.
4. Aplicar només als grups `SAFE_AUTOMATIC` amb decisió humana `ACCEPT` explícita al fitxer de decisions — mai automàticament només perquè el detector ho classifiqui `SAFE_AUTOMATIC`.
