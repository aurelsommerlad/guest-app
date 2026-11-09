// Local browser tests only (M4): loads the guest-services Apaleo simulator (EXTRAS_REPO,
// default ../guest-services) into a Node process, e.g.
//   NODE_OPTIONS="--import <this file>" APALEO_SIM_STATE=/tmp/sim.json next dev
// The simulator replaces fetch for api.apaleo.com / identity.apaleo.com and refuses every other
// host except localhost and Google Fonts. This wrapper only adds `token_type` to the simulated
// token answer, which STAY's Apaleo client validates. Never used outside local development.
import path from "node:path";
import { pathToFileURL } from "node:url";

if (process.env.APP_ENV && process.env.APP_ENV !== "local") {
  throw new Error("apaleo-sim-preload: local development only");
}
const repo =
  process.env.EXTRAS_REPO ?? path.resolve(import.meta.dirname, "../../../../guest-services");
await import(pathToFileURL(path.join(repo, "test/support/apaleo-simulator.mjs")).href);
const simulated = globalThis.fetch;
globalThis.fetch = async function simulatedFetchWithTokenType(input, init) {
  const url = new URL(
    typeof input === "string" || input instanceof URL ? String(input) : input.url,
  );
  if (url.hostname === "identity.apaleo.com") {
    await simulated(input, init);
    return Response.json({ access_token: "simulated", expires_in: 3600, token_type: "Bearer" });
  }
  return simulated(input, init);
};
