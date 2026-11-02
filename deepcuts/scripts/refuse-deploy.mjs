console.error(
  "No direct release command is provided. Preview releases require the gated Deep Cuts GitHub workflow. Production is not enabled. See docs/DEPLOYMENT.md.",
);
process.exitCode = 1;
