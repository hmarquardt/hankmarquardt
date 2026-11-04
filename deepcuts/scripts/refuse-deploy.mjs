console.error(
  "Direct npm deployment is disabled. Production releases use the gated Deep Cuts GitHub Actions workflow after validation. See docs/DEPLOYMENT.md.",
);
process.exitCode = 1;
