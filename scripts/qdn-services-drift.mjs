// Pure drift comparison between Home's QDN service whitelist and Core's
// GET /arbitrary/services catalogue. No I/O, no node, no source scraping.
//
// It lives apart from scripts/smoke-qdn-services.mjs on purpose: the smoke
// script owns the one thing that genuinely needs a live node (fetching the
// catalogue), and everything it then decides happens here, where
// scripts/test-qdn-services-drift.mjs can drive it with fabricated catalogues.

// Core's catalogue is the authority for this check, so a shape it does not
// recognize is a hard stop rather than a silently skipped comparison. A missing
// `private` flag in particular would quietly turn check 3 into a no-op.
export function parseServiceCatalogue(catalogue) {
  if (!Array.isArray(catalogue) || catalogue.length === 0) {
    throw new Error('GET /arbitrary/services did not return a non-empty array.');
  }

  return catalogue.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`Core catalogue entry #${index} is not an object.`);
    }

    if (typeof entry.id !== 'string' || entry.id === '') {
      throw new Error(`Core catalogue entry #${index} has no string "id".`);
    }

    if (typeof entry.private !== 'boolean') {
      throw new Error(
        `Core catalogue entry ${entry.id} has no boolean "private" flag; ` +
          `Core's /arbitrary/services contract changed and this guard can no longer check it.`,
      );
    }

    return { id: entry.id, private: entry.private };
  });
}

// Returns every disagreement between Home and Core as a list of failure
// messages, plus informational notes that must never fail the run.
//
// `isPrivateService` is injected rather than imported so the caller decides
// which predicate is under test — the smoke script passes Home's real
// isPrivateQdnService, the unit test also passes deliberately wrong ones.
export function findCatalogueDrift({ homeServices, catalogue, isPrivateService }) {
  const services = parseServiceCatalogue(catalogue);
  const coreById = new Map(services.map((service) => [service.id, service]));
  const homeSet = new Set(homeServices);
  const failures = [];
  const notes = [];

  // 1. Every service Home offers must still exist in Core.
  const unknownToCore = [...homeServices].filter((name) => !coreById.has(name));

  if (unknownToCore.length > 0) {
    failures.push(
      `Home lists service(s) that Core no longer reports: ${unknownToCore.join(', ')}. ` +
        `They were renamed or removed in Core; update electron/qdn-public-services.ts.`,
    );
  }

  // 2. Home browses public services only, so none of its entries may be
  //    private in Core.
  const privateInCore = [...homeServices].filter((name) => coreById.get(name)?.private === true);

  if (privateInCore.length > 0) {
    failures.push(
      `Home lists service(s) that Core reports as private: ${privateInCore.join(', ')}. ` +
        `Private services need the encrypted-resource flow, not the public whitelist.`,
    );
  }

  // 3. Home decides "is this private?" with a `_PRIVATE` suffix heuristic while
  //    Core states it outright. Checked across the whole catalogue, because the
  //    dangerous case is a service Home has never heard of.
  const privateOnlyInCore = [];
  const privateOnlyInHome = [];

  for (const service of services) {
    const homeSaysPrivate = isPrivateService(service.id) === true;

    if (homeSaysPrivate === service.private) {
      continue;
    }

    (service.private ? privateOnlyInCore : privateOnlyInHome).push(service.id);
  }

  if (privateOnlyInCore.length > 0) {
    failures.push(
      `Core reports service(s) as private that Home's _PRIVATE-suffix rule reads as public: ` +
        `${privateOnlyInCore.join(', ')}. Home would try to browse an encrypted resource; ` +
        `teach isPrivateQdnService about them.`,
    );
  }

  if (privateOnlyInHome.length > 0) {
    failures.push(
      `Home's _PRIVATE-suffix rule reads service(s) as private that Core reports as public: ` +
        `${privateOnlyInHome.join(', ')}. Home would refuse to open a service anyone can read.`,
    );
  }

  // 4. Informational only: Home deliberately does not surface system and
  //    chat-internal services, so an omission is never a failure.
  const notSurfaced = services
    .filter((service) => !service.private && !homeSet.has(service.id))
    .map((service) => service.id);

  if (notSurfaced.length > 0) {
    notes.push(
      `${notSurfaced.length} public Core service(s) are not surfaced by Home ` +
        `(expected for system/chat-internal services): ${notSurfaced.join(', ')}.`,
    );
  }

  return {
    failures,
    notes,
    coreCount: services.length,
    corePublicCount: services.filter((service) => !service.private).length,
    notSurfaced,
  };
}
