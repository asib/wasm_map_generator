// A dependency graph that contains any wasm must all be imported
// asynchronously. This `bootstrap.js` file does the single async import, so
// that no one else needs to worry about it again.
import("./m4.js")
  .catch(e => console.error("Error importing `index.js`:", e));
import("./webgl-utils.js")
  .catch(e => console.error("Error importing `index.js`:", e));
import("./index.js")
  .catch(e => console.error("Error importing `index.js`:", e));
