import { describe, expect, it } from "vitest";

import {
  getPersistedSettings,
  migrateLegacySettingKeys
} from "../src/session/persistence";

describe("migrateLegacySettingKeys", () => {
  it("carries piExperimentalFeaturesEnabled forward to allowPiUserConfig", () => {
    const migrated = migrateLegacySettingKeys({
      piExperimentalFeaturesEnabled: true
    });
    expect(migrated.allowPiUserConfig).toBe(true);
  });

  it("preserves a legacy false rather than dropping to the default", () => {
    const migrated = migrateLegacySettingKeys({
      piExperimentalFeaturesEnabled: false
    });
    expect(migrated.allowPiUserConfig).toBe(false);
  });

  it("does not override an explicit new-key value", () => {
    const migrated = migrateLegacySettingKeys({
      allowPiUserConfig: false,
      piExperimentalFeaturesEnabled: true
    });
    expect(migrated.allowPiUserConfig).toBe(false);
  });

  it("ignores a non-boolean legacy value", () => {
    const migrated = migrateLegacySettingKeys({
      piExperimentalFeaturesEnabled: "yes"
    });
    expect(migrated.allowPiUserConfig).toBeUndefined();
  });

  it("leaves settings without the legacy key untouched", () => {
    expect(migrateLegacySettingKeys({ ollamaHost: "x" })).toEqual({
      ollamaHost: "x"
    });
  });
});

describe("getPersistedSettings", () => {
  it("migrates through the modern nested shape", () => {
    const settings = getPersistedSettings({
      settings: { piExperimentalFeaturesEnabled: true }
    });
    expect(settings.allowPiUserConfig).toBe(true);
  });

  it("migrates through the pre-schemaVersion flat shape", () => {
    const settings = getPersistedSettings({
      piExperimentalFeaturesEnabled: true
    });
    expect(settings.allowPiUserConfig).toBe(true);
  });

  it("returns empty for absent or malformed data", () => {
    expect(getPersistedSettings(undefined)).toEqual({});
    expect(getPersistedSettings("nonsense")).toEqual({});
  });
});
