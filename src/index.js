#!/usr/bin/env node
// Hide Node's deprecation noise from dependencies; it only confuses users.
process.noDeprecation = true;
await import('./cli.js');
