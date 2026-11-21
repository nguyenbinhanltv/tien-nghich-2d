// Registers every tool. To add a tool: create tools/<name>.mjs and add one line below.
import { ToolRegistry } from '../registry.mjs';
import projectInfo from './project_info.mjs';

export function buildRegistry() {
  const registry = new ToolRegistry();
  registry.register(projectInfo);
  // P1+ seams, one line each, e.g.:
  //   registry.register(catalogSearch);   // scope 'read'
  //   registry.register(framesSubmit);    // scope 'author'
  //   registry.register(pack);            // scope 'pack'
  return registry;
}
