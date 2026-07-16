'use strict';
const defaultEvents = require('../models/events.model');

// dwell > 30 min = une app oubliée ouverte, pas de l'attention (aligné sur le
// check SQL de deck_events) ; payload > 2 Ko = du bagage, pas de la mesure.
const DWELL_MAX_MS = 1_800_000;
const PAYLOAD_MAX_BYTES = 2048;

/**
 * Entonnoir de la télémétrie. Le zod de la route borne les formes ; ici on
 * applique ce que le schéma ne sait pas dire : pas d'auto-mesure (self-target
 * jeté EN SILENCE), dwell clampé, payload borné. La télémétrie n'est JAMAIS
 * bloquante : on nettoie sans lever — on ne dérange pas le client pour des
 * miettes de mesure.
 */
function createEventsService({ events }) {
  async function ingest(viewerId, rawEvents) {
    const cleaned = (rawEvents || [])
      .filter((e) => e.targetId !== viewerId)
      .map((e) => ({
        kind: e.kind,
        targetId: e.targetId,
        clientRef: e.clientRef,
        dwellMs: e.dwellMs == null
          ? null
          : Math.round(Math.min(DWELL_MAX_MS, Math.max(0, e.dwellMs))),
        payload: fitPayload(e.payload),
      }));
    if (!cleaned.length) return { accepted: 0 };
    const accepted = await events.ingest(viewerId, cleaned);
    return { accepted };
  }

  return { ingest };
}

/** Payload normalisé : absent → {}, obèse → {} (l'événement survit, pas son bagage). */
function fitPayload(payload) {
  if (payload == null) return {};
  try {
    return JSON.stringify(payload).length > PAYLOAD_MAX_BYTES ? {} : payload;
  } catch {
    return {};
  }
}

const defaultService = createEventsService({ events: defaultEvents });

module.exports = { createEventsService, ingest: defaultService.ingest };
