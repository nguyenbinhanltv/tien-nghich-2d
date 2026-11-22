#!/usr/bin/env node
// Compatibility shim: the smoke test moved to playables/smoke-test.mjs.
// Importing it runs it (it is a script), so arguments pass straight through.
import '../playables/smoke-test.mjs';
