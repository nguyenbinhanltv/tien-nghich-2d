#!/usr/bin/env node
// Compatibility shim: the smoke test moved to studio/smoke-test.mjs.
// Importing it runs it (it is a script), so arguments pass straight through.
import '../studio/smoke-test.mjs';
