import { normalizeBackendOrigin } from "../apps/mobile/src/core/backend/preference";

const origin = normalizeBackendOrigin(
  process.argv[2] ?? "https://hyper-trader-backend.clawearn.xyz",
);
console.log(JSON.stringify({ version: 1, origin }));
