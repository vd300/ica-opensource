const { build } = require("./package.json")

// Local Windows QA artifact. Configure credentials in Settings after launching.
module.exports = {
  ...build,
  directories: { ...build.directories, output: "release/voice-qa" },
  electronDist: process.platform === "win32" && process.arch === "x64"
    ? "node_modules/electron/dist" : undefined,
  extraResources: [],
  publish: null,
  win: { ...build.win, signAndEditExecutable: false }
}
