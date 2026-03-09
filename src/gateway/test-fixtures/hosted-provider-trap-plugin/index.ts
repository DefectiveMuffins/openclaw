import fs from "node:fs";

const markerPath = process.env.OPENCLAW_TEST_HOSTED_PROVIDER_MARKER_PATH?.trim();

export default {
  register() {
    if (markerPath) {
      fs.writeFileSync(markerPath, "loaded", "utf8");
    }
  },
};
