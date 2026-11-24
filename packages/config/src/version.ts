/** Current app release and build metadata. Historical details live in VERSION_HISTORY.md. */
export interface VersionInfo {
  build: string;
  release: string;
}

const CURRENT_BUILD = "17954871";
const CURRENT_RELEASE = "2.3.0";

export const APP_VERSION: VersionInfo = {
  build: CURRENT_BUILD,
  release: CURRENT_RELEASE,
};
